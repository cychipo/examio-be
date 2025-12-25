"""
Intelligent Metadata Filtering System
Kết hợp hard matching, semantic matching và fallback mechanism
"""

import re
from typing import List, Dict, Any, Optional, Tuple
from sentence_transformers import SentenceTransformer
import numpy as np
from langchain_core.documents import Document

class IntelligentMetadataFilter:
    def __init__(self, similarity_threshold: float = 0.7):
        """
        Args:
            similarity_threshold: Ngưỡng similarity cho semantic matching (0.0-1.0)
        """
        self.similarity_threshold = similarity_threshold
        self.embedding_model = None
        self.department_embeddings = None
        self.department_list = None
        self._init_semantic_model()
    
    def _init_semantic_model(self):
        """Initialize semantic model for soft matching"""
        try:
            # Sử dụng model nhẹ cho tiếng Việt
            self.embedding_model = SentenceTransformer('keepitreal/vietnamese-sbert')
        except:
            try:
                # Fallback model
                self.embedding_model = SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
            except:
                print("⚠️  Cannot load embedding model for semantic filtering")
                self.embedding_model = None
    
    def normalize_query(self, query: str) -> str:
        """Chuẩn hóa query của người dùng"""
        if not query:
            return ""
        
        # Chuyển về lowercase
        normalized = query.lower().strip()
        
        # Xử lý các từ viết tắt phổ biến
        abbreviations = {
            'attt': 'an toàn thông tin',
            'cntt': 'công nghệ thông tin', 
            'kt': 'kinh tế',
            'qtdn': 'quản trị doanh nghiệp',
            'tc': 'tín chỉ',
            'đbclgd': 'đảm bảo chất lượng giáo dục'
        }
        
        for abbr, full_form in abbreviations.items():
            normalized = re.sub(f'\\b{abbr}\\b', full_form, normalized)
        
        # Chuẩn hóa khoảng trắng
        normalized = re.sub(r'\s+', ' ', normalized)
        
        # Xóa dấu câu không cần thiết
        normalized = re.sub(r'[^\w\sàáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]', ' ', normalized)
        
        return normalized.strip()
    
    def extract_keywords_from_query(self, normalized_query: str) -> List[str]:
        """Trích xuất keywords từ normalized query"""
        # Danh sách stop words tiếng Việt
        stop_words = {
            'của', 'là', 'có', 'được', 'trong', 'về', 'cho', 'từ', 'và', 'hoặc', 
            'các', 'một', 'này', 'đó', 'khi', 'với', 'để', 'hay', 'những', 'sẽ',
            'như', 'thì', 'tại', 'trên', 'dưới', 'giữa', 'bên', 'ngoài', 'sau',
            'trước', 'theo', 'bằng', 'qua', 'ra', 'vào', 'lên', 'xuống'
        }
        
        # Tách từ và lọc stop words
        words = normalized_query.split()
        keywords = [word for word in words if len(word) > 2 and word not in stop_words]
        
        # Trích xuất cụm từ có ý nghĩa (bigrams, trigrams)
        meaningful_phrases = []
        
        # Bigrams
        for i in range(len(words) - 1):
            if words[i] not in stop_words and words[i+1] not in stop_words:
                meaningful_phrases.append(f"{words[i]} {words[i+1]}")
        
        # Trigrams cho các cụm từ tổ chức
        for i in range(len(words) - 2):
            if any(org_word in ' '.join(words[i:i+3]) for org_word in ['phòng', 'ban', 'khoa', 'viện']):
                meaningful_phrases.append(' '.join(words[i:i+3]))
        
        return keywords + meaningful_phrases
    
    def hard_match_metadata(self, keywords: List[str], metadata_config: Dict) -> Optional[Dict[str, Any]]:
        """Hard matching với keywords từ metadata config"""
        filters = {}
        
        # Get keyword mappings from config
        query_keywords = metadata_config.get('query_keywords', {})
        
        # Check department keywords
        if 'departments' in query_keywords:
            for dept, dept_keywords in query_keywords['departments'].items():
                # Exact match hoặc partial match
                for keyword in keywords:
                    for dept_keyword in dept_keywords:
                        if (keyword == dept_keyword or 
                            keyword in dept_keyword or 
                            dept_keyword in keyword):
                            filters['department'] = dept
                            print(f"🎯 Hard match found: '{keyword}' → department='{dept}'")
                            break
                    if 'department' in filters:
                        break
                if 'department' in filters:
                    break
        
        # Check education level keywords
        if 'education_levels' in query_keywords:
            for level, level_keywords in query_keywords['education_levels'].items():
                for keyword in keywords:
                    for level_keyword in level_keywords:
                        if (keyword == level_keyword or 
                            keyword in level_keyword or 
                            level_keyword in keyword):
                            filters['education_level'] = level
                            print(f"🎯 Hard match found: '{keyword}' → education_level='{level}'")
                            break
                    if 'education_level' in filters:
                        break
                if 'education_level' in filters:
                    break
        
        return filters if filters else None
    
    def semantic_match_metadata(self, normalized_query: str, metadata_config: Dict) -> Optional[Dict[str, Any]]:
        """Semantic matching sử dụng embeddings"""
        if not self.embedding_model:
            return None
        
        try:
            # Prepare department descriptions for semantic comparison
            departments = metadata_config.get('query_keywords', {}).get('departments', {})
            
            if not departments:
                return None
            
            # Create semantic descriptions for each department
            dept_descriptions = {}
            for dept_key, keywords in departments.items():
                # Tạo description từ keywords
                desc = ' '.join(keywords[:10])  # Lấy 10 keywords đầu
                dept_descriptions[dept_key] = desc
            
            # Get embeddings for query and department descriptions
            query_embedding = self.embedding_model.encode([normalized_query])
            dept_embeddings = self.embedding_model.encode(list(dept_descriptions.values()))
            
            # Calculate cosine similarity
            similarities = np.dot(query_embedding, dept_embeddings.T)[0]
            max_similarity_idx = np.argmax(similarities)
            max_similarity = similarities[max_similarity_idx]
            
            # Check if similarity is above threshold
            if max_similarity >= self.similarity_threshold:
                dept_key = list(dept_descriptions.keys())[max_similarity_idx]
                print(f"🧠 Semantic match found: similarity={max_similarity:.3f} → department='{dept_key}'")
                return {'department': dept_key}
            else:
                print(f"🧠 Semantic similarity too low: max={max_similarity:.3f} < threshold={self.similarity_threshold}")
                return None
                
        except Exception as e:
            print(f"⚠️  Semantic matching error: {e}")
            return None
    
    def intelligent_filter(self, query: str, metadata_config: Dict) -> Tuple[Optional[Dict[str, Any]], str]:
        """
        Intelligent metadata filtering với multi-level approach
        
        Returns:
            Tuple[Optional[Dict], str]: (metadata_filter, strategy_used)
        """
        # Step 1: Normalize query
        normalized_query = self.normalize_query(query)
        if not normalized_query:
            return None, "empty_query"
        
        print(f"📝 Normalized query: '{query}' → '{normalized_query}'")
        
        # Step 2: Extract keywords
        keywords = self.extract_keywords_from_query(normalized_query)
        if not keywords:
            return None, "no_keywords"
        
        print(f"🔑 Extracted keywords: {keywords}")
        
        # Step 3: Hard matching first
        hard_match_result = self.hard_match_metadata(keywords, metadata_config)
        if hard_match_result:
            return hard_match_result, "hard_match"
        
        print("❌ Hard match failed, trying semantic matching...")
        
        # Step 4: Semantic matching
        semantic_match_result = self.semantic_match_metadata(normalized_query, metadata_config)
        if semantic_match_result:
            return semantic_match_result, "semantic_match"
        
        print("❌ Semantic match failed, will fallback to hybrid retrieval")
        
        # Step 5: No filtering (fallback to hybrid retrieval)
        return None, "fallback"
    
    def filter_documents(self, documents: List[Document], metadata_filter: Dict[str, Any]) -> List[Document]:
        """Filter documents based on metadata"""
        if not metadata_filter:
            return documents
        
        filtered_docs = []
        for doc in documents:
            match = True
            for key, value in metadata_filter.items():
                if key not in doc.metadata or doc.metadata[key] != value:
                    match = False
                    break
            if match:
                filtered_docs.append(doc)
        
        return filtered_docs


# Integration với smart_retrieve function
def enhanced_smart_retrieve(retriever, query: str, metadata_config: Dict, 
                          similarity_threshold: float = 0.7,
                          min_results_threshold: int = 3) -> List[Document]:
    """
    Enhanced smart retrieve với intelligent metadata filtering
    """
    # Initialize intelligent filter
    intelligent_filter = IntelligentMetadataFilter(similarity_threshold)
    
    # Get intelligent metadata filter
    metadata_filter, strategy = intelligent_filter.intelligent_filter(query, metadata_config)
    
    print(f"🎯 Filtering strategy: {strategy}")
    
    if metadata_filter:
        print(f"🔍 Applied metadata filter: {metadata_filter}")
        
        # Try retrieval with filter
        filtered_results = retriever._get_relevant_documents(query, metadata_filter)
        
        # Check if we have enough results
        if len(filtered_results) >= min_results_threshold:
            print(f"✅ Found {len(filtered_results)} results with {strategy}")
            return apply_context_boosting(filtered_results, query)
        else:
            print(f"⚠️  Only {len(filtered_results)} results with {strategy}, falling back to hybrid retrieval")
    
    # Fallback to hybrid retrieval (no filtering)
    print("🔄 Using hybrid retrieval (no metadata filtering)")
    initial_results = retriever._get_relevant_documents(query)
    return apply_context_boosting(initial_results, query)


# Placeholder for apply_context_boosting (import from your existing code)
def apply_context_boosting(documents: List[Document], query: str) -> List[Document]:
    """Placeholder - use your existing apply_context_boosting function"""
    return documents