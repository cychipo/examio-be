"""
Graph Builder for Document Graph Construction
Xây dựng graph từ documents với các loại edges khác nhau
"""
import os
import logging
from typing import List, Dict, Any, Tuple
import networkx as nx
from langchain_core.documents import Document
from langchain_ollama import OllamaEmbeddings
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity
from dotenv import load_dotenv

load_dotenv()
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_EMBEDDING_MODEL = os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text:latest")

logger = logging.getLogger(__name__)


class DocumentGraph:
    """Build and manage document graph with multiple edge types"""
    
    def __init__(self, 
                 semantic_threshold: float = 0.7,  # Increase threshold to reduce noise
                 max_semantic_edges_per_node: int = 5,  # Limit edges per node
                 embeddings_model: str = None):
        """
        Args:
            semantic_threshold: Ngưỡng similarity để tạo semantic edge (default: 0.8)
            max_semantic_edges_per_node: Số lượng semantic edges tối đa mỗi node (default: 5)
            embeddings_model: Model để tính embeddings (None = use env var)
        """
        self.graph = nx.Graph()
        self.semantic_threshold = semantic_threshold
        self.max_semantic_edges_per_node = max_semantic_edges_per_node
        
        # Use env variable if model not specified
        model = embeddings_model or OLLAMA_EMBEDDING_MODEL
        print(f"📊 Graph Builder using Ollama embedding model: {model}")
        print(f"⚙️  Config: threshold={semantic_threshold}, max_edges/node={max_semantic_edges_per_node}")
        
        self.embeddings = OllamaEmbeddings(
            model=model,
            base_url=OLLAMA_BASE_URL
        )
        self.doc_embeddings = {}  # Cache embeddings
        
        # Community metadata for persistence
        self.community_summaries = {}      # Dict[community_id, summary_text]
        self.community_centroids = {}      # Dict[community_id, centroid_vector] 
        self.community_members = {}        # Dict[community_id, Set[node_ids]]
        
    def build_graph(self, documents: List[Document]) -> nx.Graph:
        """
        Xây dựng graph từ documents với 3 loại edges:
        1. Structural edges (cùng file)
        2. Metadata edges (cùng metadata)
        3. Semantic edges (semantic similarity)
        """
        logger.info(f"Building graph from {len(documents)} documents...")
        
        # Add nodes
        for i, doc in enumerate(documents):
            self.graph.add_node(
                i,
                content=doc.page_content,
                metadata=doc.metadata,
                document=doc
            )
        
        # Add edges
        self._add_structural_edges(documents)
        self._add_metadata_edges(documents)
        self._add_semantic_edges(documents)
        
        logger.info(f"Graph built: {self.graph.number_of_nodes()} nodes, {self.graph.number_of_edges()} edges")
        
        # Build communities and generate metadata
        logger.info("Building communities and generating metadata...")
        self._build_communities()
        
        return self.graph
    
    def _build_communities(self):
        """Build communities and generate LLM-based summaries"""
        from .subgraph_partitioner import SubgraphPartitioner
        
        # Create partitioner and run community detection
        partitioner = SubgraphPartitioner(self.graph)
        partitioner.partition_by_community_detection(algorithm='louvain')
        
        # Store community metadata for persistence
        self.community_summaries = partitioner.community_summaries.copy()
        self.community_centroids = partitioner.community_centroids.copy()
        self.community_members = {}
        
        # Convert subgraphs (Set) to members (Set) for serialization
        for comm_id, node_set in partitioner.subgraphs.items():
            self.community_members[comm_id] = set(node_set)  # Ensure it's a set
        
        logger.info(f"✅ Built {len(self.community_summaries)} communities with LLM summaries")
    
    def get_community_metadata(self):
        """Get community metadata for external use"""
        return {
            'summaries': self.community_summaries,
            'centroids': self.community_centroids,
            'members': self.community_members
        }
    
    def _add_structural_edges(self, documents: List[Document]):
        """Add edges between chunks from the same file"""
        logger.info("Adding structural edges...")
        
        # Group by source file
        file_groups = {}
        for i, doc in enumerate(documents):
            source = doc.metadata.get('source', '')
            if source not in file_groups:
                file_groups[source] = []
            file_groups[source].append(i)
        
        # Add edges within each file group
        edge_count = 0
        for source, node_ids in file_groups.items():
            for i in range(len(node_ids) - 1):
                self.graph.add_edge(
                    node_ids[i], 
                    node_ids[i + 1],
                    edge_type='structural',
                    weight=1.0
                )
                edge_count += 1
        
        logger.info(f"Added {edge_count} structural edges")
    
    def _add_metadata_edges(self, documents: List[Document]):
        """Add edges between documents with same metadata (category, department, etc.)"""
        logger.info("Adding metadata edges...")
        
        # Group by multiple metadata fields for better routing
        metadata_fields = ['category', 'department', 'education_level', 'file_type']
        edge_count = 0
        
        for field in metadata_fields:
            field_groups = {}
            for i, doc in enumerate(documents):
                value = doc.metadata.get(field, '')
                if value:
                    if value not in field_groups:
                        field_groups[value] = []
                    field_groups[value].append(i)
            
            # Add edges within each group (connect sequential nodes)
            for value, node_ids in field_groups.items():
                # Connect each node to next 2 nodes in same group (reduce density)
                for i in range(len(node_ids)):
                    for j in range(i + 1, min(i + 3, len(node_ids))):
                        # Weight based on field importance
                        weight = 0.9 if field == 'category' else 0.7
                        if not self.graph.has_edge(node_ids[i], node_ids[j]):
                            self.graph.add_edge(
                                node_ids[i],
                                node_ids[j],
                                edge_type=f'metadata_{field}',
                                weight=weight
                            )
                            edge_count += 1
        
        logger.info(f"Added {edge_count} metadata edges")
    
    def _add_semantic_edges(self, documents: List[Document]):
        """Add edges between semantically similar documents using ANN for speed"""
        logger.info("Adding semantic edges with ANN optimization...")
        
        # Compute embeddings for all documents
        texts = [doc.page_content for doc in documents]
        logger.info(f"Computing embeddings for {len(texts)} documents...")
        
        # Batch embed để tăng tốc
        batch_size = 50
        all_embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            embeddings_batch = self.embeddings.embed_documents(batch)
            all_embeddings.extend(embeddings_batch)
            logger.info(f"Embedded {min(i + batch_size, len(texts))}/{len(texts)} documents")
        
        # Cache embeddings in dict AND in graph nodes
        for i, emb in enumerate(all_embeddings):
            emb_array = np.array(emb)
            self.doc_embeddings[i] = emb_array
            # Store embedding in graph node for fast retrieval
            self.graph.nodes[i]['embedding'] = emb_array
        
        # Use ANN (FAISS) for faster neighbor search
        edge_count = 0
        embeddings_matrix = np.array(all_embeddings).astype('float32')
        
        # Build FAISS index for fast similarity search
        logger.info("Building FAISS index for ANN search...")
        try:
            import faiss
            
            dim = embeddings_matrix.shape[1]
            
            # Normalize vectors for cosine similarity
            faiss.normalize_L2(embeddings_matrix)
            
            # Use IndexFlatIP for small datasets (< 10k), or IndexIVFFlat for larger
            if len(documents) < 10000:
                index = faiss.IndexFlatIP(dim)  # Inner product = cosine for normalized vectors
            else:
                # For larger datasets, use IVF index
                nlist = min(100, len(documents) // 10)
                quantizer = faiss.IndexFlatIP(dim)
                index = faiss.IndexIVFFlat(quantizer, dim, nlist)
                index.train(embeddings_matrix)
            
            index.add(embeddings_matrix)
            logger.info(f"FAISS index built with {index.ntotal} vectors")
            
            # Find top-k neighbors using ANN
            k = self.max_semantic_edges_per_node + 1  # +1 to account for self
            distances, indices = index.search(embeddings_matrix, k)
            
            # Add edges based on ANN results
            for i in range(len(documents)):
                for j_idx in range(1, k):  # Skip first (self)
                    j = indices[i][j_idx]
                    similarity = float(distances[i][j_idx])  # Already cosine similarity
                    
                    if similarity >= self.semantic_threshold and i != j:
                        if not self.graph.has_edge(i, j):
                            self.graph.add_edge(
                                i, j,
                                edge_type='semantic',
                                weight=similarity
                            )
                            edge_count += 1
            
            logger.info(f"✅ Added {edge_count} semantic edges using FAISS ANN (avg {edge_count/len(documents):.1f} edges/node)")
            
        except ImportError:
            # Fallback to brute-force if FAISS not available
            logger.warning("FAISS not available, falling back to brute-force similarity...")
            similarities = cosine_similarity(embeddings_matrix)
            
            for i in range(len(documents)):
                node_similarities = similarities[i]
                node_similarities[i] = -1  # Exclude self
                
                if self.max_semantic_edges_per_node > 0:
                    top_k_indices = np.argsort(node_similarities)[-self.max_semantic_edges_per_node:]
                    
                    for j in top_k_indices:
                        sim = similarities[i][j]
                        if sim >= self.semantic_threshold and i != j:
                            if not self.graph.has_edge(i, j):
                                self.graph.add_edge(
                                    i, j,
                                    edge_type='semantic',
                                    weight=float(sim)
                                )
                                edge_count += 1
            
            logger.info(f"Added {edge_count} semantic edges (avg {edge_count/len(documents):.1f} edges/node)")
    
    def get_neighbors(self, node_id: int, edge_type: str = None) -> List[int]:
        """Get neighbors of a node, optionally filtered by edge type"""
        if node_id not in self.graph:
            return []
        
        neighbors = []
        for neighbor in self.graph.neighbors(node_id):
            if edge_type is None:
                neighbors.append(neighbor)
            else:
                edge_data = self.graph.get_edge_data(node_id, neighbor)
                if edge_data and edge_data.get('edge_type') == edge_type:
                    neighbors.append(neighbor)
        
        return neighbors
    
    def get_subgraph(self, node_ids: List[int]) -> nx.Graph:
        """Extract subgraph containing specified nodes"""
        return self.graph.subgraph(node_ids).copy()
    
    def get_document(self, node_id: int) -> Document:
        """Get document from node"""
        return self.graph.nodes[node_id]['document']
    
    def save_graph(self, filepath: str):
        """Save graph to file with community metadata"""
        import pickle
        with open(filepath, 'wb') as f:
            # Save graph, embeddings cache, AND community metadata
            pickle.dump({
                'graph': self.graph,
                'doc_embeddings': self.doc_embeddings,
                'semantic_threshold': self.semantic_threshold,
                # Community metadata for routing
                'community_summaries': self.community_summaries,
                'community_centroids': self.community_centroids,
                'community_members': self.community_members
            }, f)
        logger.info(f"Graph saved to {filepath} (with community metadata)")
    
    def load_graph(self, filepath: str):
        """Load graph from file with community metadata"""
        import pickle
        with open(filepath, 'rb') as f:
            data = pickle.load(f)
            self.graph = data['graph']
            self.doc_embeddings = data['doc_embeddings']
            self.semantic_threshold = data['semantic_threshold']
            
            # Load community metadata if available
            self.community_summaries = data.get('community_summaries', {})
            self.community_centroids = data.get('community_centroids', {})
            self.community_members = data.get('community_members', {})
            
        logger.info(f"Graph loaded from {filepath} (communities: {len(self.community_summaries)})")
