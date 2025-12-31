"""
Department Graph Manager - ENHANCED WITH SEMANTIC SIMILARITY
Quản lý graph riêng biệt cho từng phòng ban/đơn vị
Sử dụng dual-signal approach với semantic similarity
"""
import os
import logging
from typing import Dict, List, Optional, Set, Any
import networkx as nx
from langchain_core.documents import Document

from .graph_builder import DocumentGraph
from .subgraph_partitioner import SubgraphPartitioner
from .graph_retriever import GraphRoutedRetriever
from .semantic_department_detector import SemanticDepartmentDetector, DepartmentDecision

logger = logging.getLogger(__name__)


class DepartmentGraphManager:
    """
    Enhanced Department Graph Manager với semantic similarity
    Sử dụng dual-signal approach để detect department chính xác hơn
    """
    
    def __init__(self, base_output_dir: str = "department_graphs"):
        self.base_output_dir = base_output_dir
        self.department_graphs: Dict[str, DocumentGraph] = {}
        self.department_partitioners: Dict[str, SubgraphPartitioner] = {}
        self.department_retrievers: Dict[str, GraphRoutedRetriever] = {}
        
        # Initialize semantic detector
        self.semantic_detector = SemanticDepartmentDetector(
            embeddings_dir=os.path.join(base_output_dir, "embeddings")
        )
        
        # Mapping phòng ban từ đường dẫn
        self.department_mapping = {
            'phongdaotao': ['phongdaotao', 'dao_tao', 'daotao'],
            'phongkhaothi': ['phongkhaothi', 'khao_thi', 'khaothi', 'chat_luong'],
            'khoa': ['khoa'],
            'viennghiencuuvahoptacphattrien': ['viennghiencuu', 'nghien_cuu', 'hop_tac'],
            'thongtinhvktmm': ['thongtin', 'hvktmm', 'hoc_vien'],
            'common': ['giao_trinh', 'chung']  # Tài liệu chung
        }
        
        # Từ khóa để xác định phòng ban từ query - IMPROVED KEYWORDS
        self.department_keywords = {
            'phongdaotao': [
                # Core education keywords
                'đào tạo', 'học tập', 'sinh viên', 'học viên', 'giảng viên', 'khóa học', 'chương trình',
                'đại học', 'thạc sĩ', 'tiến sĩ', 'cử nhân', 'cao học', 'luận văn', 'luận án',
                'k68', 'k69', 'k70', 'học phí', 'tuyển sinh', 'tốt nghiệp',
                # Academic scoring - SPECIFIC PHRASES
                'điểm học phần', 'cách tính điểm', 'tính điểm', 'công thức điểm',
                'điểm trung bình', 'điểm tích lũy', 'xếp loại học tập',
                # Course management
                'học phần', 'tín chỉ', 'môn học', 'bài tập', 'thời khóa biểu',
                'lịch học', 'phòng học', 'giáo trình', 'đề cương'
            ],
            'phongkhaothi': [
                # Core examination keywords  
                'khảo thí', 'thi', 'kiểm tra', 'đánh giá', 'chất lượng',
                'quy đổi điểm', 'toeic', 'ielts', 'toefl', 'cambridge', 'tiếng anh',
                'kỳ thi', 'đề thi', 'coi thi', 'chấm thi', 
                # Regulations and rules - HIGH PRIORITY
                'quy định', 'công tác khảo thí', 'quy chế thi', 'kỷ luật thi',
                'phòng thi', 'giám thị', 'thí sinh', 'bài thi', 'điểm thi',
                # Specific exam processes
                'thi kết thúc', 'thi giữa kỳ', 'thi phụ', 'phúc khảo',
                'miễn thi', 'hoãn thi', 'thi lại', 'coi thi', 'chấm thi'
            ],
            'khoa': [
                'khoa', 'ngành', 'chuyên ngành', 'attt', 'cntt', 'dtvt', 'an toàn thông tin',
                'công nghệ thông tin', 'điện tử viễn thông', 'bộ môn', 'giáo trình'
            ],
            'viennghiencuuvahoptacphattrien': [
                'nghiên cứu', 'khoa học', 'hợp tác', 'phát triển', 'đề tài', 'dự án',
                'công bố', 'tạp chí', 'hội thảo', 'báo cáo', 'sáng chế'
            ],
            'thongtinhvktmm': [
                'học viện', 'hvktmm', 'cơ yếu', 'chuyển đổi số', 'sáng kiến',
                'giới thiệu', 'lịch sử', 'tổ chức', 'ban giám hiệu'
            ]
        }
    
    def detect_department_from_path(self, file_path: str) -> str:
        """
        Xác định phòng ban từ đường dẫn file
        """
        file_path_lower = file_path.lower().replace('\\', '/').replace(' ', '_')
        
        for dept, variants in self.department_mapping.items():
            for variant in variants:
                if variant in file_path_lower:
                    return dept
        
        # Default: common (tài liệu chung)
        return 'common'
    
    def detect_department_smart(
        self, 
        query: str, 
        user_metadata: Dict[str, Any] = None,
        top_k: int = 2
    ) -> DepartmentDecision:
        """
        Smart department detection sử dụng dual-signal approach
        """
        return self.semantic_detector.detect_department(query, user_metadata)
    
    def detect_department_from_query(self, query: str, top_k: int = 2) -> List[str]:
        """
        Legacy method - kept for backward compatibility
        Sử dụng semantic detection nhưng trả về format cũ
        """
        decision = self.semantic_detector.detect_department(query, user_metadata={'role': 'student'})
        
        # Nếu permission denied, fallback to common
        if not decision.permission_granted:
            logger.warning(f"🚫 Permission denied for department {decision.chosen_department}")
            return ['common']
        
        # Return chosen department + fallbacks
        result = [decision.chosen_department]
        
        # Add other high-confidence departments as fallbacks
        for signal in decision.signals:
            if (signal.department != decision.chosen_department and 
                signal.confidence > 0.3 and 
                signal.department not in result):
                result.append(signal.department)
        
        return result[:top_k]
        """
        Xác định phòng ban liên quan từ query - IMPROVED VERSION
        Trả về list các phòng ban có thể liên quan (theo thứ tự ưu tiên)
        """
        query_lower = query.lower()
        department_scores = {}
        
        # High-priority phrase patterns
        phrase_patterns = {
            'phongkhaothi': [
                'công tác khảo thí', 'quy định khảo thí', 'kỷ luật thi', 
                'quy chế thi', 'công tác thi', 'phòng thi'
            ],
            'phongdaotao': [
                'điểm học phần', 'cách tính điểm', 'điểm trung bình',
                'chương trình đào tạo', 'kế hoạch học tập'
            ]
        }
        
        # Score cho phrase matching (high priority)
        for dept, phrases in phrase_patterns.items():
            phrase_score = 0
            for phrase in phrases:
                if phrase in query_lower:
                    # Phrase matching có điểm cao
                    phrase_score += len(phrase.split()) * 3  # x3 multiplier for phrases
            
            if phrase_score > 0:
                department_scores[dept] = department_scores.get(dept, 0) + phrase_score
        
        # Score cho keyword matching
        for dept, keywords in self.department_keywords.items():
            keyword_score = 0
            matched_keywords = []
            
            for keyword in keywords:
                if keyword in query_lower:
                    # Từ khóa dài có trọng số cao hơn
                    weight = len(keyword.split())
                    
                    # Special weighting rules
                    if dept == 'phongdaotao' and 'điểm' in keyword:
                        # Ưu tiên "điểm học phần" hơn "điểm" đơn lẻ
                        if keyword == 'điểm học phần':
                            weight *= 2
                        elif keyword == 'điểm':
                            weight *= 0.5  # Reduce weight for generic "điểm"
                    
                    if dept == 'phongkhaothi' and keyword == 'quy định':
                        weight *= 1.5  # Boost "quy định" for khảo thí
                    
                    keyword_score += weight
                    matched_keywords.append(keyword)
            
            if keyword_score > 0:
                department_scores[dept] = department_scores.get(dept, 0) + keyword_score
                logger.debug(f"🔍 {dept}: {matched_keywords} -> score: {keyword_score}")
        
        # Remove very low scores (likely false positives)
        department_scores = {dept: score for dept, score in department_scores.items() if score >= 1.0}
        
        # Sắp xếp theo điểm số
        sorted_depts = sorted(department_scores.items(), key=lambda x: x[1], reverse=True)
        
        # Log scoring for debugging
        logger.debug(f"🎯 Query: '{query[:50]}...'")
        for dept, score in sorted_depts:
            logger.debug(f"   {dept}: {score}")
        
        # Trả về top-k phòng ban
        result = [dept for dept, score in sorted_depts[:top_k]]
        
        # Nếu không tìm thấy phòng ban cụ thể, tìm trong tất cả
        if not result:
            logger.warning(f"Không xác định được phòng ban từ query: {query[:100]}")
            return list(self.department_graphs.keys())
        
        return result
    
    def build_department_graphs(self, documents: List[Document]) -> Dict[str, int]:
        """
        Xây dựng graph riêng cho từng phòng ban từ documents
        
        Returns:
            Dict[department, node_count] - Thống kê số node mỗi phòng ban
        """
        logger.info("=" * 80)
        logger.info("🏢 BUILDING DEPARTMENT-SPECIFIC GRAPHS")
        logger.info("=" * 80)
        
        # Phân loại documents theo phòng ban
        dept_documents = {}
        for doc in documents:
            source_path = doc.metadata.get('source', '')
            dept = self.detect_department_from_path(source_path)
            
            if dept not in dept_documents:
                dept_documents[dept] = []
            dept_documents[dept].append(doc)
        
        # Thống kê
        logger.info(f"📊 Documents by department:")
        for dept, docs in dept_documents.items():
            logger.info(f"   {dept}: {len(docs)} documents")
        
        # Xây dựng graph cho từng phòng ban
        stats = {}
        os.makedirs(self.base_output_dir, exist_ok=True)
        
        for dept, docs in dept_documents.items():
            if len(docs) == 0:
                logger.warning(f"⚠️  Skipping {dept}: No documents")
                continue
                
            logger.info(f"\n🔨 Building graph for department: {dept}")
            logger.info(f"   Documents: {len(docs)}")
            
            # Tạo graph builder cho phòng ban này
            graph_builder = DocumentGraph(
                semantic_threshold=0.7,
                max_semantic_edges_per_node=7
            )
            
            # Xây dựng graph
            graph = graph_builder.build_graph(docs)
            self.department_graphs[dept] = graph_builder
            
            # Tạo partitioner
            partitioner = SubgraphPartitioner(graph)
            communities = partitioner.partition_by_community_detection(algorithm='louvain')
            self.department_partitioners[dept] = partitioner
            
            # Tạo retriever
            retriever = GraphRoutedRetriever(
                graph=graph,
                partitioner=partitioner,
                k=4,
                internal_k=8,
                hop_depth=2,
                expansion_factor=1.5
            )
            self.department_retrievers[dept] = retriever
            
            # Lưu graph
            dept_output_dir = os.path.join(self.base_output_dir, dept)
            os.makedirs(dept_output_dir, exist_ok=True)
            graph_path = os.path.join(dept_output_dir, "graph.pkl")
            graph_builder.save_graph(graph_path)
            
            # Thống kê
            stats[dept] = {
                'nodes': graph.number_of_nodes(),
                'edges': graph.number_of_edges(),
                'communities': len(communities),
                'avg_degree': 2 * graph.number_of_edges() / graph.number_of_nodes() if graph.number_of_nodes() > 0 else 0
            }
            
            logger.info(f"   ✅ Graph built: {stats[dept]['nodes']} nodes, {stats[dept]['edges']} edges")
            logger.info(f"   📁 Saved to: {graph_path}")
        
        # Tổng kết
        logger.info("\n" + "=" * 80)
        logger.info("✅ DEPARTMENT GRAPHS BUILD COMPLETE!")
        logger.info("=" * 80)
        
        total_nodes = sum(s['nodes'] for s in stats.values())
        total_edges = sum(s['edges'] for s in stats.values())
        
        logger.info(f"📊 Total: {len(stats)} departments, {total_nodes} nodes, {total_edges} edges")
        for dept, stat in stats.items():
            logger.info(f"   {dept}: {stat['nodes']} nodes, {stat['communities']} communities")
        
        return {dept: stat['nodes'] for dept, stat in stats.items()}
    
    def load_department_graphs(self) -> bool:
        """
        Load các graph đã xây dựng từ disk
        
        Returns:
            bool - True nếu load thành công
        """
        if not os.path.exists(self.base_output_dir):
            logger.error(f"Department graphs directory not found: {self.base_output_dir}")
            return False
        
        loaded_count = 0
        for dept_name in os.listdir(self.base_output_dir):
            dept_dir = os.path.join(self.base_output_dir, dept_name)
            if not os.path.isdir(dept_dir):
                continue
                
            graph_path = os.path.join(dept_dir, "graph.pkl")
            if not os.path.exists(graph_path):
                logger.warning(f"Graph file not found for {dept_name}: {graph_path}")
                continue
            
            try:
                # Load graph
                graph_builder = DocumentGraph()
                graph_builder.load_graph(graph_path)
                self.department_graphs[dept_name] = graph_builder
                
                # Recreate partitioner
                partitioner = SubgraphPartitioner(graph_builder.graph)
                # Re-run community detection
                communities = partitioner.partition_by_community_detection(algorithm='louvain')
                self.department_partitioners[dept_name] = partitioner
                
                # Recreate retriever
                retriever = GraphRoutedRetriever(
                    graph=graph_builder.graph,
                    partitioner=partitioner,
                    k=4,
                    internal_k=8,
                    hop_depth=2,
                    expansion_factor=1.5
                )
                self.department_retrievers[dept_name] = retriever
                
                loaded_count += 1
                logger.info(f"✅ Loaded graph for {dept_name}: {graph_builder.graph.number_of_nodes()} nodes")
                
            except Exception as e:
                logger.error(f"❌ Failed to load graph for {dept_name}: {e}")
        
        logger.info(f"📊 Loaded {loaded_count} department graphs")
        return loaded_count > 0
    
    def query_department(self, query: str, department: str, k: int = 4) -> List[Document]:
        """
        Query trong graph của phòng ban cụ thể
        
        Args:
            query: Câu hỏi
            department: Tên phòng ban
            k: Số lượng documents trả về
            
        Returns:
            List[Document] - Kết quả tìm kiếm
        """
        if department not in self.department_retrievers:
            logger.error(f"Department {department} not found in retrievers")
            return []
        
        logger.info(f"🔍 Querying department '{department}' with query: {query[:100]}")
        
        retriever = self.department_retrievers[department]
        retriever.k = k  # Update k dynamically
        
        try:
            results = retriever.get_relevant_documents(query)
            logger.info(f"✅ Found {len(results)} documents in {department}")
            return results
        except Exception as e:
            logger.error(f"❌ Error querying {department}: {e}")
            return []
    
    def query_multi_department(self, query: str, departments: List[str], k: int = 4) -> List[Document]:
        """
        Query trong nhiều phòng ban và merge kết quả
        
        Args:
            query: Câu hỏi
            departments: Danh sách phòng ban
            k: Số lượng documents tổng cộng
            
        Returns:
            List[Document] - Kết quả merged và ranked
        """
        all_results = []
        k_per_dept = max(1, k // len(departments)) if departments else k
        
        logger.info(f"🔍 Multi-department query: {departments}, k={k_per_dept} per dept")
        
        for dept in departments:
            if dept in self.department_retrievers:
                dept_results = self.query_department(query, dept, k_per_dept)
                # Add department info to metadata
                for doc in dept_results:
                    doc.metadata['query_department'] = dept
                all_results.extend(dept_results)
        
        # Re-rank combined results và limit to k
        if len(all_results) > k:
            # Sort by relevance score if available
            all_results.sort(key=lambda d: d.metadata.get('combined_score', 0), reverse=True)
            all_results = all_results[:k]
        
        logger.info(f"✅ Multi-department query returned {len(all_results)} documents")
        return all_results
    
    def query_smart(self, query: str, user_department: str = None, k: int = 4) -> List[Document]:
        """
        Smart query - Tự động xác định phòng ban và query
        
        Args:
            query: Câu hỏi
            user_department: Phòng ban của user (nếu có)
            k: Số lượng documents
            
        Returns:
            List[Document] - Kết quả tìm kiếm
        """
        logger.info(f"🧠 Smart query: '{query[:100]}', user_dept='{user_department}'")
        
        # 1. Xác định phòng ban từ query
        query_departments = self.detect_department_from_query(query, top_k=2)
        
        # 2. Ưu tiên phòng ban của user nếu có
        target_departments = []
        if user_department and user_department in self.department_retrievers:
            target_departments.append(user_department)
        
        # 3. Thêm phòng ban từ query (nếu chưa có)
        for dept in query_departments:
            if dept not in target_departments:
                target_departments.append(dept)
        
        # 4. Fallback: tìm trong tất cả phòng ban nếu không xác định được
        if not target_departments:
            target_departments = list(self.department_retrievers.keys())
            logger.warning(f"Using fallback: search all departments {target_departments}")
        
        logger.info(f"🎯 Target departments: {target_departments}")
        
        # 5. Query
        if len(target_departments) == 1:
            return self.query_department(query, target_departments[0], k)
        else:
            return self.query_multi_department(query, target_departments, k)
    
    def get_department_stats(self) -> Dict[str, Dict]:
        """
        Lấy thống kê của tất cả department graphs
        """
        stats = {}
        for dept, graph_builder in self.department_graphs.items():
            graph = graph_builder.graph
            partitioner = self.department_partitioners.get(dept)
            
            stats[dept] = {
                'nodes': graph.number_of_nodes(),
                'edges': graph.number_of_edges(),
                'communities': len(partitioner.communities) if partitioner else 0,
                'avg_degree': 2 * graph.number_of_edges() / graph.number_of_nodes() if graph.number_of_nodes() > 0 else 0
            }
        
        return stats
    
    def list_available_departments(self) -> List[str]:
        """Liệt kê các phòng ban có sẵn"""
        return list(self.department_retrievers.keys())