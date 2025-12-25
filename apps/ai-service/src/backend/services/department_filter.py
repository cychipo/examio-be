"""
Folder-based query filtering service
"""
from typing import Optional, Dict, Any
import os


class DepartmentFilterService:
    """Service to filter queries based on folder structure in data directory"""
    
    # Map folder names to display names
    FOLDER_MAPPINGS = {
        'chung': {
            'display_name': 'Tất cả',
            'description': 'Tất cả thông tin từ mọi phòng ban và đơn vị'
        },
        'phongdaotao': {
            'display_name': 'Phòng Đào tạo',
            'description': 'Thông tin về đào tạo, học tập, tốt nghiệp'
        },
        'phongkhaothi': {
            'display_name': 'Phòng Khảo thí',
            'description': 'Thông tin về thi cử, kiểm tra, khảo thí'
        },
        'khoa': {
            'display_name': 'Các Khoa',
            'description': 'Thông tin về các khoa, chuyên ngành'
        },
        'thongtinHVKTMM': {
            'display_name': 'Thông tin HVKTMM',
            'description': 'Thông tin chung về Học viện Kỹ thuật Mật mã'
        },
        'viennghiencuuvahoptacphattrien': {
            'display_name': 'Viện Nghiên cứu',
            'description': 'Thông tin về nghiên cứu và hợp tác phát triển'
        }
    }
    
    @classmethod
    def get_available_folders(cls) -> Dict[str, Dict[str, str]]:
        """Get all available folders with their display info"""
        return cls.FOLDER_MAPPINGS
    
    @classmethod
    def validate_query_scope(cls, query: str, selected_folder: Optional[str], query_metadata_department: Optional[str]) -> tuple[bool, str]:
        """
        Validate if query can be answered based on folder scope
        
        Args:
            query: The user query
            selected_folder: Folder selected by user (e.g., 'phongdaotao', 'default')  
            query_metadata_department: Department detected from query content
            
        Returns:
            (is_allowed, reason)
        """
        # Allow all queries if no folder selected (general access)
        if not selected_folder or selected_folder == 'all':
            return True, "General access - all folders allowed"
        
        # Allow all queries if 'chung', 'default', or any "all" variant is selected
        if selected_folder in ['chung', 'default']:
            return True, "General folder selected - all queries allowed"
        
        # Check if selected folder exists in our mappings
        if selected_folder not in cls.FOLDER_MAPPINGS:
            return False, f"Unknown folder: {selected_folder}"
        
        # If no metadata department detected from query, restrict to specific folders
        if not query_metadata_department:
            folder_name = cls.FOLDER_MAPPINGS.get(selected_folder, {}).get('display_name', selected_folder)
            return False, f"Câu hỏi không thuộc phạm vi '{folder_name}'. Vui lòng chọn 'Tất cả' để truy vấn chung."
        
        # Check if query's detected department matches selected folder
        if query_metadata_department == selected_folder:
            return True, f"Query matches selected folder: {selected_folder}"
        else:
            folder_name = cls.FOLDER_MAPPINGS.get(selected_folder, {}).get('display_name', selected_folder)
            return False, f"Câu hỏi vượt ngoài phạm vi '{folder_name}'. Vui lòng chọn phạm vi phù hợp."
    
    @classmethod
    def get_metadata_filter(cls, folder: Optional[str]) -> Optional[Dict[str, Any]]:
        """Get metadata filter for selected folder"""
        if not folder or folder == 'all':
            return None  # No filtering for general access
        
        if folder in cls.FOLDER_MAPPINGS:
            return {'department': folder}
        
        return None
    
    @classmethod
    def get_folder_info(cls, folder: str) -> Dict[str, Any]:
        """Get folder configuration info"""
        return cls.FOLDER_MAPPINGS.get(folder, {})