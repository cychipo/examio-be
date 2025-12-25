"""
Subgraph Partitioner for Document Graph
AUTOMATED community detection & hierarchical clustering
No hardcoded rules, fully data-driven
"""
import logging
from typing import List, Dict, Any, Set, Tuple
import networkx as nx
from langchain_core.documents import Document
import numpy as np
from src.llm.config import get_llm  # Sử dụng get_llm() để respect runtime model selection

logger = logging.getLogger(__name__)


class SubgraphPartitioner:
    """Automated partition of document graph using community detection"""
    
    def __init__(self, graph: nx.Graph):
        """
        Args:
            graph: Document graph from DocumentGraph
        """
        self.graph = graph
        self.subgraphs = {}  # Dict[subgraph_id, Set[node_ids]]
        self.community_summaries = {}  # Dict[community_id, summary_text]
        self.community_embeddings = {}  # Dict[community_id, embedding_vector]
        self.community_centroids = {}  # Dict[community_id, centroid_vector]
        self.llm = None  # Will be initialized when needed
    
    @property
    def communities(self):
        """Alias for subgraphs for backward compatibility"""
        return self.subgraphs
        
    def partition_by_metadata(self, metadata_key: str = 'category') -> Dict[str, Set[int]]:
        """
        Partition graph by metadata category (hierarchical)
        
        Args:
            metadata_key: Metadata field to partition by (e.g., 'category', 'department')
            
        Returns:
            Dict mapping category -> set of node IDs
        """
        logger.info(f"Partitioning graph by metadata: {metadata_key}")
        
        subgraphs = {}
        
        for node_id in self.graph.nodes():
            metadata = self.graph.nodes[node_id]['metadata']
            category = metadata.get(metadata_key, 'unknown')
            
            if category not in subgraphs:
                subgraphs[category] = set()
            
            subgraphs[category].add(node_id)
        
        self.subgraphs = subgraphs
        
        # Log statistics
        for category, nodes in subgraphs.items():
            logger.info(f"  Subgraph '{category}': {len(nodes)} nodes")
        
        return subgraphs
    
    def partition_by_community_detection(self, algorithm: str = 'louvain', generate_summaries: bool = True) -> Dict[int, Set[int]]:
        """
        HYBRID: Partition graph using metadata-aware community detection
        Combines structural clustering with metadata constraints
        
        Args:
            algorithm: 'louvain' (default) or 'label_propagation'
            generate_summaries: Whether to generate LLM summaries (False for loading existing graphs)
            
        Returns:
            Dict mapping community_id -> set of node IDs
        """
        logger.info(f"Hybrid partitioning with {algorithm} + metadata...")
        
        # IMPROVEMENT 1: Pre-partition by metadata to preserve hierarchical structure
        metadata_groups = self._pregroup_by_metadata()
        
        # IMPROVEMENT 2: Run community detection within each metadata group
        all_subgraphs = {}
        comm_id_counter = 0
        
        for meta_key, node_ids in metadata_groups.items():
            if len(node_ids) < 2:
                # Single node groups become their own community
                all_subgraphs[comm_id_counter] = node_ids
                comm_id_counter += 1
                continue
            
            # Create subgraph for this metadata group
            subgraph = self.graph.subgraph(node_ids)
            
            if algorithm == 'louvain':
                try:
                    import community as community_louvain
                    communities = community_louvain.best_partition(subgraph)
                except ImportError:
                    logger.warning("python-louvain not installed, falling back to label_propagation")
                    algorithm = 'label_propagation'
            
            if algorithm == 'label_propagation':
                from networkx.algorithms import community
                communities_gen = community.label_propagation_communities(subgraph)
                communities = {}
                for local_comm_id, nodes in enumerate(communities_gen):
                    for node in nodes:
                        communities[node] = local_comm_id
            
            # Map local communities to global IDs
            local_subgraphs = {}
            for node, local_comm_id in communities.items():
                if local_comm_id not in local_subgraphs:
                    local_subgraphs[local_comm_id] = set()
                local_subgraphs[local_comm_id].add(node)
            
            # Assign global community IDs
            for nodes in local_subgraphs.values():
                all_subgraphs[comm_id_counter] = nodes
                comm_id_counter += 1
        
        self.subgraphs = all_subgraphs
        
        # BUGFIX: Assign community attribute to all nodes
        logger.info("Assigning community IDs to nodes...")
        for comm_id, node_ids in all_subgraphs.items():
            for node_id in node_ids:
                self.graph.nodes[node_id]['community'] = comm_id
        
        # Auto-generate community summaries and centroids (optional)
        if generate_summaries:
            self._generate_community_metadata()
        else:
            logger.info("Skipping community summary generation (load mode)")
        
        # Log statistics
        logger.info(f"Found {len(all_subgraphs)} communities (metadata-aware)")
        for comm_id, nodes in list(all_subgraphs.items())[:5]:
            summary = self.community_summaries.get(comm_id, '')
            logger.info(f"  Community {comm_id}: {len(nodes)} nodes - {summary[:80]}...")
        
        return all_subgraphs
    
    def _pregroup_by_metadata(self) -> Dict[str, Set[int]]:
        """
        Pre-group nodes by hierarchical metadata path
        E.g., phongdaotao/daihoc, phongdaotao/thacsi, khoa, etc.
        """
        groups = {}
        
        for node_id in self.graph.nodes():
            metadata = self.graph.nodes[node_id]['metadata']
            
            # Build hierarchical key from category
            category = metadata.get('category', 'unknown')
            
            # Normalize category to hierarchical path
            if '/' in category:
                # Already hierarchical (e.g., phongdaotao/daihoc)
                key = category
            else:
                # Flat category (e.g., khoa, phongkhaothi)
                key = category
            
            if key not in groups:
                groups[key] = set()
            groups[key].add(node_id)
        
        logger.info(f"Pre-grouped into {len(groups)} metadata categories")
        return groups
    
    def _select_top_k_nodes(self, node_ids: Set[int], k: int = 20) -> List[int]:
        """
        Intelligent selection of top-k most important nodes from community
        Based on: content length, node degree, keyword relevance
        """
        node_scores = []
        
        for node_id in node_ids:
            content = self.graph.nodes[node_id].get('content', '')
            degree = self.graph.degree(node_id)
            
            # Score based on multiple factors
            content_score = len(content.strip())  # Content length
            connectivity_score = degree * 10  # Node connectivity
            
            # Keyword importance (boost nodes with important keywords)
            keyword_score = 0
            important_keywords = ['hệ thống', 'phần mềm', 'quản lý', 'phiên bản', 'CVS', 'git', 'subversion']
            content_lower = content.lower()
            for keyword in important_keywords:
                if keyword in content_lower:
                    keyword_score += 50
            
            total_score = content_score + connectivity_score + keyword_score
            node_scores.append((node_id, total_score, content))
        
        # Sort by score and return top-k
        node_scores.sort(key=lambda x: x[1], reverse=True)
        return [node_id for node_id, _, _ in node_scores[:k]]
    
    def _generate_llm_summary(self, node_contents: List[str], community_id: int) -> str:
        """
        Generate community summary using LLM
        """
        if self.llm is None:
            self.llm = get_llm()  # Sử dụng get_llm() để respect runtime model selection
        
        # Prepare context from top nodes
        context_parts = []
        for i, content in enumerate(node_contents[:10], 1):  # Use top 10 for LLM
            context_parts.append(f"[Node {i}]: {content[:500]}...")  # 500 chars per node
        
        context = "\n\n".join(context_parts)
        
        prompt = f"""Cho các đoạn văn bản sau thuộc cùng một community trong GraphRAG.
Hãy tóm tắt nội dung chính, các khái niệm quan trọng và mối quan hệ giữa chúng.
Không được suy diễn hoặc thêm thông tin không tồn tại.

Trả về theo cấu trúc:

**Tóm tắt:** [Tóm tắt ngắn gọn nội dung chính]

**Chủ đề chính:** [Lĩnh vực/chủ đề chính được đề cập]

**Khái niệm & quan hệ:** [Các khái niệm quan trọng và mối liên hệ giữa chúng]

Nội dung:
{context}"""
        
        try:
            response = self.llm.invoke(prompt)
            summary = response.content.strip()
            logger.info(f"✅ Generated LLM summary for Community {community_id}: {summary[:100]}...")
            return summary
        except Exception as e:
            logger.error(f"❌ LLM summary generation failed for Community {community_id}: {e}")
            # Fallback to simple concatenation
            return " | ".join([content[:200] for content in node_contents[:3]])
    
    def _generate_community_metadata(self):
        """
        ENHANCED: Create LLM-generated summaries with intelligent node selection
        """
        logger.info("Generating enhanced community metadata with LLM...")
        
        for comm_id, node_ids in self.subgraphs.items():
            logger.info(f"Processing Community {comm_id} with {len(node_ids)} nodes...")
            
            # 1. Select top-k most important nodes
            top_nodes = self._select_top_k_nodes(node_ids, k=20)
            
            # 2. Extract content from selected nodes
            node_contents = []
            embeddings = []
            categories = []
            
            for node_id in top_nodes:
                content = self.graph.nodes[node_id].get('content', '')
                metadata = self.graph.nodes[node_id].get('metadata', {})
                
                if content.strip():
                    node_contents.append(content)
                
                # Collect category info
                category = metadata.get('category', '')
                if category and category not in categories:
                    categories.append(category)
                
                # Get embedding if cached
                embedding = self.graph.nodes[node_id].get('embedding')
                if embedding is not None:
                    embeddings.append(embedding)
            
            # 3. Generate LLM summary
            if node_contents:
                summary = self._generate_llm_summary(node_contents, comm_id)
            else:
                summary = f"Community {comm_id} (no content)"
            
            # 4. Add category prefix if available
            if categories:
                primary_category = categories[0]
                summary = f"[{primary_category}] {summary}"
            
            self.community_summaries[comm_id] = summary
            
            # Store metadata for routing
            if not hasattr(self, 'community_metadata'):
                self.community_metadata = {}
            self.community_metadata[comm_id] = {
                'categories': categories,
                'node_count': len(node_ids)
            }
            
            # 3. Create WEIGHTED centroid: top-k + weighted average
            if embeddings:
                # Method 1: Use ALL embeddings but weight by node importance
                weights = []
                for node_id in list(node_ids)[:len(embeddings)]:
                    # Weight by node degree (more connected = more important)
                    degree = self.graph.degree(node_id)
                    # Weight by content length (longer = more informative)
                    content_len = len(self.graph.nodes[node_id].get('content', ''))
                    # Combined weight
                    weight = np.log(degree + 1) * np.log(content_len + 1)
                    weights.append(weight)
                
                # Normalize weights
                weights = np.array(weights)
                weights = weights / weights.sum() if weights.sum() > 0 else np.ones_like(weights) / len(weights)
                
                # Weighted average
                weighted_centroid = np.average(embeddings, axis=0, weights=weights)
                self.community_centroids[comm_id] = weighted_centroid
        
        logger.info(f"✅ Generated enhanced metadata for {len(self.subgraphs)} communities")
        logger.info(f"💡 Using weighted centroids based on node degree + content length")
    
    def get_subgraph(self, subgraph_id: Any) -> Set[int]:
        """Get node IDs in a subgraph"""
        return self.subgraphs.get(subgraph_id, set())
    
    def get_all_subgraphs(self) -> Dict[Any, Set[int]]:
        """Get all subgraphs"""
        return self.subgraphs
    
    def get_subgraph_for_node(self, node_id: int) -> Any:
        """Find which subgraph contains a node"""
        for subgraph_id, nodes in self.subgraphs.items():
            if node_id in nodes:
                return subgraph_id
        return None
    
    def route_query_to_communities(self, query_embedding: np.ndarray, top_k: int = 5, min_similarity: float = 0.25, adaptive: bool = True) -> List[Tuple[int, float]]:
        """
        ENHANCED ROUTING: Multi-stage routing với weighted centroids
        
        Quy trình:
        1. Chuyển query thành embedding ✓ 
        2. So sánh với weighted community centroids ✓
        3. Multi-factor scoring (semantic + metadata + size) ✓
        4. Adaptive top-k selection ✓
        5. Quality threshold filtering ✓
        
        Args:
            query_embedding: Query embedding vector
            top_k: Base number of communities (default: 5, optimized for 9 total communities)
            min_similarity: Minimum similarity threshold (default: 0.25, more permissive)
            adaptive: Enable adaptive expansion if confidence is low
            
        Returns:
            List of (community_id, similarity_score) tuples, ranked by relevance
        """
        if not self.community_centroids:
            logger.warning("No community centroids available. Run partition_by_community_detection first.")
            return []
        
        # ENHANCED: Multi-factor scoring với weighted centroids
        community_scores = []
        
        for comm_id, centroid in self.community_centroids.items():
            # Factor 1: Semantic similarity với weighted centroid
            semantic_sim = np.dot(query_embedding, centroid) / (
                np.linalg.norm(query_embedding) * np.linalg.norm(centroid)
            )
            
            # Factor 2: Community quality/diversity boost
            diversity_boost = 0.0
            size_boost = 0.0
            if hasattr(self, 'community_metadata'):
                meta = self.community_metadata.get(comm_id, {})
                node_count = meta.get('node_count', 0)
                
                # Size boost: Moderate preference for larger communities (more information)
                size_boost = min(0.05, node_count / 1000)  # Max 0.05 boost for 1000+ nodes
                
                # Diversity boost: Multi-category communities get slight boost
                categories = meta.get('categories', [])
                if len(categories) > 1:
                    diversity_boost = 0.02
            
            # Combined score: 90% semantic + 5% size + 5% diversity
            final_score = 0.90 * semantic_sim + 0.05 * size_boost + 0.05 * diversity_boost
            community_scores.append((comm_id, float(final_score)))
        
        # Sort by score desc
        community_scores.sort(key=lambda x: x[1], reverse=True)
        
        # ADAPTIVE: Quality-based selection strategy
        if not community_scores:
            logger.warning("No community centroids available")
            return []
        
        best_score = community_scores[0][1]
        
        # Strategy 1: High confidence (best score > 0.5) → take top-k
        if best_score > 0.5:
            selected = [item for item in community_scores[:top_k] if item[1] >= min_similarity]
            logger.info(f"🎯 High confidence routing: best_score={best_score:.3f}, selected {len(selected)}/{top_k}")
            
        # Strategy 2: Medium confidence (0.3-0.5) → expand to top_k+2 (max 7)
        elif best_score > 0.3:
            expanded_k = min(top_k + 2, 7, len(community_scores))
            selected = [item for item in community_scores[:expanded_k] if item[1] >= min_similarity]
            logger.info(f"🎯 Medium confidence routing: best_score={best_score:.3f}, expanded to {len(selected)}/{expanded_k}")
            
        # Strategy 3: Low confidence (< 0.3) → search all communities
        else:
            expanded_k = len(community_scores)  # Search all 9 communities
            selected = community_scores[:expanded_k]  # Ignore threshold for low confidence
            logger.info(f"⚠️ Low confidence routing: best_score={best_score:.3f}, searching all {len(selected)} communities")
        
        # Fallback: Always return at least 1 community
        if not selected and community_scores:
            selected = [community_scores[0]]
            logger.warning(f"⚠️ Fallback: No communities above threshold, using best match (score={selected[0][1]:.3f})")
        
        # Log selected communities for debugging
        logger.info("🏘️ Selected communities:")
        for i, (comm_id, score) in enumerate(selected[:5]):
            node_count = len(self.subgraphs.get(comm_id, []))
            summary = self.community_summaries.get(comm_id, '')[:50]
            logger.info(f"   {i+1}. Community {comm_id}: score={score:.3f}, size={node_count}, summary='{summary}...'")
        
        return selected
