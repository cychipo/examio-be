"""
Chatbot Evaluation Script using RAGAS metrics
Evaluates chatbot performance with correctness, faithfulness, context_relevance, answer_relevance
Rate limited to 10 questions per minute
"""

import pandas as pd
import asyncio
import time
import json
import pickle
import networkx as nx
from datetime import datetime
from typing import List, Dict, Any
import requests
import os
import sys
from datasets import Dataset

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src'))

# Import RAGAS metrics
try:
    from ragas import evaluate
    from ragas.metrics import (
        answer_correctness,
        faithfulness, 
        context_recall,
        context_relevance,
        answer_relevance
    )
    print("✅ RAGAS imported successfully")
except ImportError as e:
    print(f"❌ Error importing RAGAS: {e}")
    print("Please install: pip install ragas")
    sys.exit(1)

# Import Gemini LLM and Graph RAG system
try:
    from llm.config import get_gemini_llm
    from graph_rag.graph_retriever import GraphRoutedRetriever
    from graph_rag.graph_builder import DocumentGraph
    from graph_rag.subgraph_partitioner import SubgraphPartitioner
    print("✅ Gemini LLM and Graph RAG system imported successfully")
except ImportError as e:
    print(f"❌ Error importing Gemini LLM/Graph RAG: {e}")
    print("Please check your environment setup")
    sys.exit(1)

class ChatbotEvaluator:
    def __init__(self, use_gemini=True, api_base_url="http://localhost:3434"):
        self.use_gemini = use_gemini
        self.api_base_url = api_base_url
        self.rate_limit_delay = 6  # 6 seconds between requests (10 per minute)
        
        if use_gemini:
            try:
                self.llm = get_gemini_llm()
                self.graph_rag = self._load_graph_rag_system()
                print("✅ Gemini LLM and Graph RAG system initialized")
            except Exception as e:
                print(f"❌ Failed to initialize Gemini LLM: {e}")
                print("Falling back to API calls")
                self.use_gemini = False
                
        if not self.use_gemini:
            self.session = requests.Session()
            
    def _load_graph_rag_system(self):
        """Load Graph RAG system from cached files"""
        graph_cache_path = "../document_graph/graph_cache.pkl"
        
        if not os.path.exists(graph_cache_path):
            raise FileNotFoundError(f"Graph cache not found at {graph_cache_path}")
            
        print(f"📂 Loading graph from: {graph_cache_path}")
        
        with open(graph_cache_path, 'rb') as f:
            cache_data = pickle.load(f)
            
        graph = cache_data['graph']
        partitioner = cache_data['partitioner']
        
        print(f"📊 Graph loaded: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")
        print(f"🏘️ Communities: {len(partitioner.communities)}")
        
        # Initialize GraphRoutedRetriever
        retriever = GraphRoutedRetriever(
            graph=graph,
            partitioner=partitioner,
            k=5,  # Retrieve more docs for better context
            hop_depth=2,
            expansion_factor=1.5
        )
        
        return retriever
            
    def _init_graph_rag(self):
        """Initialize Graph RAG system"""
        import os
        
        # Paths for graph cache
        current_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        data_dir = os.path.join(current_dir, "data")
        graph_cache_dir = os.path.join(current_dir, "document_graph")
        
        print(f"📁 Data directory: {data_dir}")
    def _load_graph_rag_system(self):
        """Load and initialize Graph RAG system"""
        try:
            from graph_rag import GraphRoutedRetriever, DocumentGraph, SubgraphPartitioner
            
            # Paths
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            graph_cache_dir = os.path.join(project_root, "document_graph")
            graph_cache_file = os.path.join(graph_cache_dir, "graph.pkl")
            
            print(f"📊 Graph cache file: {graph_cache_file}")
            
            if not os.path.exists(graph_cache_file):
                raise FileNotFoundError(f"Graph cache not found: {graph_cache_file}")
            
            # Load graph
            graph_builder = DocumentGraph()
            graph_builder.load_graph(graph_cache_file)
            graph = graph_builder.graph
            
            # Create partitioner with community detection
            partitioner = SubgraphPartitioner(graph)
            partitioner.partition_by_community_detection(algorithm='louvain')
            
            # Create retriever
            self.retriever = GraphRoutedRetriever(
                graph=graph,
                partitioner=partitioner,
                k=4,  # Number of documents to retrieve
                hop_depth=2,
                expansion_factor=1.5
            )
            
            print(f"✅ Graph RAG loaded: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges, {len(partitioner.communities)} communities")
            return True
            
        except Exception as e:
            print(f"❌ Failed to load Graph RAG: {e}")
            import traceback
            traceback.print_exc()
            return False
            graph=self.graph,
            partitioner=self.partitioner,
            k=4,  # Number of documents to retrieve
            hop_depth=2,
            expansion_factor=1.5
        )
        
        print(f"✅ Graph RAG initialized: {self.graph.number_of_nodes()} nodes, {self.graph.number_of_edges()} edges")
            
    def load_dataset(self, csv_path: str) -> pd.DataFrame:
        """Load and clean dataset with proper encoding handling"""
        try:
            # Try different encodings
            encodings = ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']
            
            for encoding in encodings:
                try:
                    df = pd.read_csv(csv_path, encoding=encoding)
                    print(f"✅ Dataset loaded successfully with {encoding} encoding")
                    break
                except UnicodeDecodeError:
                    continue
            else:
                raise ValueError("Could not read CSV with any common encoding")
                
            print(f"Dataset shape: {df.shape}")
            print(f"Columns: {df.columns.tolist()}")
            
            # Clean column names
            df.columns = df.columns.str.strip()
            
            # Handle missing values
            df = df.dropna()
            
            print(f"After cleaning: {df.shape}")
            return df
            
        except Exception as e:
            print(f"❌ Error loading dataset: {e}")
            raise
            
    async def get_chatbot_response(self, question: str, department: str = None) -> Dict[str, Any]:
        """Get response from chatbot (Gemini LLM + Graph RAG or API)"""
        try:
            if self.use_gemini:
                # Use Gemini LLM with Graph RAG
                retrieved_docs = self.retriever.invoke(question)
                
                # Extract content and metadata from retrieved documents
                contexts = []
                context_texts = []
                
                for doc in retrieved_docs:
                    content = doc.page_content
                    context_texts.append(content)
                    
                    # Get metadata for context tracking
                    metadata = doc.metadata or {}
                    file_name = metadata.get('source', 'Unknown')
                    doc_type = metadata.get('doc_type', 'document')
                    contexts.append(f"[{doc_type}] {file_name}: {content[:200]}...")
                
                # Combine contexts for prompt
                combined_context = "\n\n".join(context_texts)
                
                prompt = f"""Dựa vào thông tin sau để trả lời câu hỏi:

{combined_context}

Câu hỏi: {question}

Hãy trả lời một cách chính xác và chi tiết dựa vào thông tin được cung cấp. Nếu thông tin không đủ để trả lời, hãy nói rõ điều đó."""

                response = self.llm.invoke(prompt)
                answer = response.content if hasattr(response, 'content') else str(response)
                
            else:
                # Use API
                payload = {
                    "content": question,
                    "is_user": True
                }
                if department:
                    payload["department"] = department
                    
                response = self.session.post(
                    f"{self.api_base_url}/api/chat/test-rag",
                    json=payload,
                    timeout=30
                )
                
                if response.status_code == 200:
                    data = response.json()
                    answer = data.get("data", {}).get("response", "No response")
                    contexts = ["API response"]  # Simplified context
                else:
                    answer = f"API Error: {response.status_code}"
                    contexts = ["Error"]
                    
            return {
                "answer": answer,
                "contexts": contexts,
                "question": question
            }
            
        except Exception as e:
            print(f"❌ Error getting chatbot response for '{question}': {e}")
            return {
                "answer": f"Error: {str(e)}",
                "contexts": ["Error"],
                "question": question
            }
            
    async def evaluate_questions(self, df: pd.DataFrame, max_questions: int = None) -> List[Dict]:
        """Evaluate all questions with rate limiting"""
        results = []
        questions = df['question'].tolist()
        expected_answers = df['answer_expected'].tolist()
        
        if max_questions:
            questions = questions[:max_questions]
            expected_answers = expected_answers[:max_questions]
            
        print(f"🔄 Evaluating {len(questions)} questions...")
        
        for i, (question, expected) in enumerate(zip(questions, expected_answers)):
            print(f"\n📝 Question {i+1}/{len(questions)}: {question[:50]}...")
            
            # Get chatbot response
            start_time = time.time()
            response = await self.get_chatbot_response(question)
            
            result = {
                "question": question,
                "answer": response["answer"],
                "ground_truth": expected,
                "contexts": response["contexts"],
                "response_time": time.time() - start_time
            }
            
            results.append(result)
            print(f"✅ Response: {response['answer'][:100]}...")
            
            # Rate limiting
            if i < len(questions) - 1:  # Don't wait after last question
                print(f"⏱️ Waiting {self.rate_limit_delay} seconds...")
                await asyncio.sleep(self.rate_limit_delay)
                
        return results
        
    def compute_ragas_metrics(self, results: List[Dict]) -> Dict[str, float]:
        """Compute RAGAS metrics on the results"""
        try:
            print(f"\n📊 Computing RAGAS metrics on {len(results)} results...")
            
            # Prepare data for RAGAS
            data = {
                "question": [r["question"] for r in results],
                "answer": [r["answer"] for r in results],
                "ground_truth": [r["ground_truth"] for r in results],
                "contexts": [r["contexts"] for r in results]
            }
            
            # Create RAGAS dataset
            dataset = Dataset.from_dict(data)
            
            # Define metrics to evaluate
            metrics = [
                answer_correctness,
                faithfulness,
                context_relevance,
                answer_relevance
            ]
            
            print("🔄 Running RAGAS evaluation...")
            evaluation_result = evaluate(dataset, metrics=metrics)
            
            # Extract scores
            scores = {
                "answer_correctness": evaluation_result["answer_correctness"],
                "faithfulness": evaluation_result["faithfulness"], 
                "context_relevance": evaluation_result["context_relevance"],
                "answer_relevance": evaluation_result["answer_relevance"]
            }
            
            print("✅ RAGAS evaluation completed")
            return scores
            
        except Exception as e:
            print(f"❌ Error computing RAGAS metrics: {e}")
            return {
                "answer_correctness": 0.0,
                "faithfulness": 0.0,
                "context_relevance": 0.0, 
                "answer_relevance": 0.0,
                "error": str(e)
            }
            
    def save_results(self, results: List[Dict], metrics: Dict[str, float], output_dir: str):
        """Save evaluation results and metrics"""
        os.makedirs(output_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save detailed results
        results_df = pd.DataFrame(results)
        results_path = os.path.join(output_dir, f"evaluation_results_{timestamp}.csv")
        results_df.to_csv(results_path, index=False, encoding='utf-8')
        print(f"💾 Detailed results saved to: {results_path}")
        
        # Save metrics summary
        metrics_path = os.path.join(output_dir, f"evaluation_metrics_{timestamp}.json")
        with open(metrics_path, 'w', encoding='utf-8') as f:
            json.dump(metrics, f, indent=2, ensure_ascii=False)
        print(f"💾 Metrics saved to: {metrics_path}")
        
        # Print summary
        print(f"\n📊 EVALUATION SUMMARY")
        print(f"{'='*50}")
        print(f"Total questions evaluated: {len(results)}")
        print(f"Average response time: {sum(r['response_time'] for r in results)/len(results):.2f}s")
        print(f"\n🎯 RAGAS METRICS:")
        for metric, score in metrics.items():
            if metric != "error":
                print(f"  {metric}: {score:.4f}")
                
        if "error" in metrics:
            print(f"\n❌ Evaluation error: {metrics['error']}")

async def main():
    """Main evaluation function"""
    print("🚀 Starting Chatbot Evaluation")
    print("="*50)
    
    # Configuration
    csv_path = "d:/KMA_ChatBot_Frontend_System/chatbot_agent/experiments/dataset chatbot update.csv"
    output_dir = "d:/KMA_ChatBot_Frontend_System/chatbot_agent/experiments/evaluation_results"
    max_questions = None  # Set to number to limit, None for all
    
    # Initialize evaluator
    evaluator = ChatbotEvaluator(use_gemini=True)
    
    try:
        # Load dataset
        df = evaluator.load_dataset(csv_path)
        
        # Run evaluation
        results = await evaluator.evaluate_questions(df, max_questions)
        
        # Compute metrics
        metrics = evaluator.compute_ragas_metrics(results)
        
        # Save results
        evaluator.save_results(results, metrics, output_dir)
        
        print("\n🎉 Evaluation completed successfully!")
        
    except Exception as e:
        print(f"\n❌ Evaluation failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    # Run the evaluation
    asyncio.run(main())