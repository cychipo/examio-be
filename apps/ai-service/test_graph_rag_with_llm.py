"""
Test Graph-Routed RAG với LLM để sinh câu trả lời
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

import asyncio
import time
from src.rag.table_aware_chunking import load_documents_from_folder
from src.rag.semantic_analyzer import analyze_query_semantic_filter
from src.graph_rag.graph_builder import DocumentGraph
from src.graph_rag.subgraph_partitioner import SubgraphPartitioner
from src.graph_rag.graph_retriever import GraphRoutedRetriever
from src.llm.config import get_gemini_llm


async def test_graph_rag_with_answer(query: str):
    """Test Graph-Routed RAG và sinh câu trả lời bằng LLM"""
    
    print("=" * 80)
    print("TESTING GRAPH-ROUTED RAG WITH LLM ANSWER")
    print("=" * 80)
    print(f"\nCau hoi: {query}\n")
    
    # Load or build graph
    graph_path = "document_graph/graph.pkl"
    # graph_path = "department_graphs/common_graph/common_graph.pkl"

    if os.path.exists(graph_path):
        print("Loading pre-built graph...")
        start_time = time.time()
        graph_builder = DocumentGraph(semantic_threshold=0.7)
        graph_builder.load_graph(graph_path)
        graph = graph_builder.graph
        load_time = time.time() - start_time
        print(f"✅ Graph loaded in {load_time:.2f}s")
        print(f"   Nodes: {graph.number_of_nodes()}")
        print(f"   Edges: {graph.number_of_edges()}")
    else:
        print("Graph not found, building new one...")
        print("   Loading documents...")
        documents = load_documents_from_folder("data")
        print(f"   Loaded {len(documents)} documents")
        
        print("   Building document graph...")
        start_time = time.time()
        graph_builder = DocumentGraph(semantic_threshold=0.7)
        graph = graph_builder.build_graph(documents)
        graph_build_time = time.time() - start_time
        print(f"   Graph built in {graph_build_time:.2f}s")
        print(f"   Nodes: {graph.number_of_nodes()}")
        print(f"   Edges: {graph.number_of_edges()}")
        
        # Save for next time
        print("   💾 Saving graph for reuse...")
        os.makedirs("document_graph", exist_ok=True)
        graph_builder.save_graph(graph_path)
        print(f"   ✅ Graph saved to {graph_path}")
    
    # Partition graph (only if not already partitioned)
    print("\n🔍 Checking graph partitioning...")
    start_time = time.time()
    partitioner = SubgraphPartitioner(graph)
    
    # Check if graph already has communities
    has_communities = any('community' in node_data for _, node_data in graph.nodes(data=True))
    
    if has_communities:
        print("✅ Graph already has communities, skipping partitioning")
        # Populate partitioner with existing communities
        communities = {}
        for node_id, node_data in graph.nodes(data=True):
            comm_id = node_data.get('community', 0)
            if comm_id not in communities:
                communities[comm_id] = set()
            communities[comm_id].add(node_id)
        partitioner.subgraphs = communities
        
        # Load community metadata from graph builder if available
        metadata = graph_builder.get_community_metadata()
        partitioner.community_summaries = metadata['summaries']
        partitioner.community_centroids = metadata['centroids']
        
        print(f"   Found {len(communities)} existing communities")
        print(f"   Loaded {len(metadata['summaries'])} summaries, {len(metadata['centroids'])} centroids")
    else:
        print("Graph not partitioned yet, running community detection...")
        partitioner.partition_by_community_detection(algorithm='label_propagation')
        partition_time = time.time() - start_time
        print(f"✅ Partitioning completed in {partition_time:.2f}s")
        print(f"   Communities: {len(partitioner.get_all_subgraphs())}")
    
    # Create retriever with balanced parameters
    print("\n🤖 Creating Graph-Routed retriever...")
    retriever = GraphRoutedRetriever(
        graph=graph,
        partitioner=partitioner,
        embeddings_model="nomic-embed-text:latest",
        k=10,  # FINAL: Top-10 sent to LLM (balance context size)
        internal_k=30,  # INTERNAL: Expand from 30*2.5=75 candidates (NOW WORKS!)
        hop_depth=3,  # Moderate hop depth for good coverage
        expansion_factor=2.5  # Balanced expansion
    )
    
    # Analyze query
    print("\n🎯 Analyzing query...")
    analysis = analyze_query_semantic_filter(query)
    category = analysis.get('category', 'general')
    confidence = analysis.get('confidence', 0)
    print(f"   Detected category: {category} (confidence: {confidence:.2f})")
    
    # Prepare filter - DISABLE for this test
    print("   ⚠️ DISABLING metadata filter to bypass semantic routing")
    metadata_filter = None
    # if category != 'general':
    #     metadata_filter = {'category': category}
    
    # Retrieve
    print("\n🔍 Retrieving relevant documents (WITHOUT metadata filter)...")
    start_time = time.time()
    docs = retriever._get_relevant_documents(query, metadata_filter=metadata_filter)
    retrieve_time = time.time() - start_time
    
    print(f"✅ Retrieved {len(docs)} documents in {retrieve_time:.3f}s\n")
    
    # Check if node 472 (chunk 65) is in retrieved docs
    print("🔍 Checking if node 472 (chunk 65 with khoản 2, 3) is retrieved...")
    node_472_found = False
    for idx, doc in enumerate(docs):
        # Find node_id for this doc
        for nid, node_data in graph.nodes(data=True):
            if node_data.get('document') is doc:
                chunk_idx = doc.metadata.get('chunk_index')
                if nid == 472 or chunk_idx == 65:
                    node_472_found = True
                    print(f"   ✅ FOUND at position {idx+1}: Node {nid}, Chunk {chunk_idx}")
                    print(f"      Score: {doc.metadata.get('relevance_score', 'N/A')}")
                    print(f"      Combined: {doc.metadata.get('combined_score', 'N/A')}")
                break
    
    if not node_472_found:
        print("   ❌ NOT FOUND - Node 472 (chunk 65) was not retrieved!")
    
    print()
    
    # Prepare context for LLM
    print("📋 Preparing context from retrieved documents...")
    context_parts = []
    num_docs_for_context = min(10, len(docs))  # Use top 10 documents or all if less
    for i, doc in enumerate(docs[:num_docs_for_context], 1):
        source = doc.metadata.get('source', 'unknown')
        context_parts.append(f"[Tài liệu {i}: {source}]\n{doc.page_content}\n")
    
    context = "\n".join(context_parts)
    
    # Create prompt for LLM
    prompt = f"""Dựa trên các tài liệu sau đây, hãy trả lời câu hỏi của người dùng một cách chi tiết và chính xác.

CÁC TÀI LIỆU THAM KHẢO:
{context}

CÂU HỎI: {query}

HƯỚNG DẪN ĐỌC BẢNG:
- Nếu bảng có dấu "+", ví dụ "6.5+", nghĩa là "6.5 trở lên" (bao gồm 7.0, 7.5, 8.0, 9.0, v.v.)
- Chọn dòng phù hợp nhất với điểm số trong câu hỏi
- Ví dụ: 7.5 IELTS thuộc nhóm "6.5+" (dòng cuối cùng)

Hãy trả lời câu hỏi dựa trên thông tin trong các tài liệu trên. Nếu thông tin không đủ để trả lời, hãy nói rõ điều đó.

TRẢ LỜI:"""

    # Generate answer using LLM
    print("\n🤖 Generating answer using Gemini LLM...")
    print(f"   Prompt length: {len(prompt)} characters")
    start_time = time.time()
    
    try:
        llm = get_gemini_llm()
        response = llm.invoke(prompt)
        generation_time = time.time() - start_time
        
        answer = response.content if hasattr(response, 'content') else str(response)
        
        print(f"✅ Answer generated in {generation_time:.2f}s\n")
        
        print("=" * 80)
        print("RETRIEVED DOCUMENTS (Top 10)")
        print("=" * 80)
        
        for j, doc in enumerate(docs[:num_docs_for_context], 1):
            source = doc.metadata.get('source', 'unknown')
            cat = doc.metadata.get('category', 'unknown')
            score = doc.metadata.get('relevance_score', 0)
            chunk_index = doc.metadata.get('chunk_index', 'N/A')
            total_chunks = doc.metadata.get('total_chunks', 'N/A')
            
            # Find node_id in graph for this document
            node_id = 'N/A'
            for nid, node_data in graph.nodes(data=True):
                if node_data.get('document') is doc:
                    node_id = nid
                    break
            
            print(f"\n📄 Document {j}")
            print(f"   Node ID in Graph: {node_id}")
            print(f"   Source: {source}")
            print(f"   Category: {cat}")
            print(f"   Chunk (metadata): {chunk_index}/{total_chunks}")
            print(f"   Relevance Score: {score:.3f}")
            print(f"   Content length: {len(doc.page_content)} characters")
            print(f"   All Metadata: {doc.metadata}")
            print(f"   Full Content:")
            print("-" * 70)
            print(doc.page_content)
            print("-" * 70)
        
        print("\n" + "=" * 80)
        print("LLM ANSWER")
        print("=" * 80)
        print(f"\n{answer}\n")
        
        print("=" * 80)
        print("📊 PERFORMANCE SUMMARY")
        print("=" * 80)
        print(f"Retrieval time: {retrieve_time:.3f}s")
        print(f"Generation time: {generation_time:.2f}s")
        print(f"Total time: {retrieve_time + generation_time:.2f}s")
        print(f"Documents retrieved: {len(docs)}")
        print(f"Documents used for context: {num_docs_for_context}")
        
    except Exception as e:
        print(f"\n❌ Error generating answer: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "=" * 80)
    print("TEST COMPLETED")
    print("=" * 80)


if __name__ == "__main__":
    # Test với query có trong data về phần mềm mã nguồn mở
    query = """Trách nhiệm chung của cán bộ coi thi là gì?
"""
    
    asyncio.run(test_graph_rag_with_answer(query))
