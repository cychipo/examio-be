# RAG Metadata Configuration
# Cấu hình metadata mapping cho hệ thống RAG

import json
import os
from typing import Dict, List, Any, Optional

class MetadataConfig:
    """Configuration class for metadata extraction and query mapping"""
    
    def __init__(self, config_path: Optional[str] = None):
        self.config_path = config_path or self._get_default_config_path()
        self.config = self._load_default_config()
        
        # Load custom config if exists
        if os.path.exists(self.config_path):
            self._load_config()
    
    def _get_default_config_path(self) -> str:
        """Get default config file path"""
        current_dir = os.path.dirname(os.path.abspath(__file__))
        return os.path.join(current_dir, 'metadata_config.json')
    
    def _load_default_config(self) -> Dict[str, Any]:
        """Load default configuration"""
        return {
            "folder_mappings": {
                "phongdaotao": {
                    "department": "phongdaotao",
                    "department_vn": "Phòng Đào Tạo",
                    "source_type": "education",
                    "subfolders": {
                        "daihoc": {
                            "education_level": "daihoc",
                            "education_level_vn": "đại học"
                        },
                        "thacsi": {
                            "education_level": "thacsi", 
                            "education_level_vn": "thạc sĩ"
                        },
                        "tiensi": {
                            "education_level": "tiensi",
                            "education_level_vn": "tiến sĩ"
                        },
                        "giangvien": {
                            "education_level": "giangvien",
                            "education_level_vn": "giảng viên"
                        }
                    }
                },
                "phongkhaothi": {
                    "department": "phongkhaothi",
                    "department_vn": "Phòng Khảo Thí",
                    "source_type": "quality_assurance",
                    "description": "Phòng Khảo thí và Đảm bảo chất lượng đào tạo"
                },
                "vanphong": {
                    "department": "vanphong",
                    "department_vn": "Văn Phòng",
                    "source_type": "administration"
                },
                "khoa": {
                    "department": "khoa", 
                    "department_vn": "Các Khoa",
                    "source_type": "academic_department"
                },
                "thongtinHVKTMM": {
                    "department": "thongtinhvktmm",
                    "department_vn": "Thông Tin HVKTMM", 
                    "source_type": "general_info"
                },
                "viennghiencuuvahoptacphattrien": {
                    "department": "viennghiencuu",
                    "department_vn": "Viện Nghiên Cứu và Hợp Tác Phát Triển",
                    "source_type": "research"
                }
            },
            "default_metadata": {
                "department": "general",
                "department_vn": "Chung",
                "source_type": "regulation"
            },
            "query_keywords": {
                "education_levels": {
                    "daihoc": ["đại học", "sinh viên", "cử nhân", "đh"],
                    "thacsi": ["thạc sĩ", "cao học", "ths"],
                    "tiensi": ["tiến sĩ", "nghiên cứu sinh", "ts"],
                    "giangvien": ["giảng viên", "giáo viên", "gv"]
                },
                "departments": {
                    "phongdaotao": ["phòng đào tạo", "đào tạo", "pdt", "điểm học phần", "điểm số", "tín chỉ", 
                                   "học phần", "điểm trung bình", "tích lũy", "học tập", "học kỳ", "thi cử", 
                                   "kiểm tra", "đánh giá", "tốt nghiệp", "xếp loại", "thang điểm", "quy chế đào tạo",
                                   "chương trình đào tạo", "đăng ký học", "học bổng", "kết quả học tập"],
                    "phongkhaothi": ["phòng khảo thí", "khảo thí", "đảm bảo chất lượng", "pkt", "dbcldt"],
                    "vanphong": ["văn phòng", "hành chính", "vp"],
                    "khoa": ["khoa", "bộ môn", "giảng dạy"],
                    "thongtinhvktmm": ["thông tin", "giới thiệu", "hvktmm", "học viện"],
                    "viennghiencuu": ["viện nghiên cứu", "nghiên cứu", "hợp tác", "phát triển", "vnc"]
                }
            },
            "chunk_settings": {
                "chunk_size": 1200,  # Increased for better context preservation
                "chunk_overlap": 300,  # Increased for better continuity  
                "separators": ["\n\n", "\n", ". ", " ", ""],
                "keep_separator": True,
                "sliding_window_size": 4  # Increased to capture more context (from 2 to 4)
            }
        }
    
    def _load_config(self):
        """Load configuration from file"""
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                custom_config = json.load(f)
                # Merge with default config
                self._merge_config(custom_config)
        except Exception as e:
            print(f"Error loading config file: {e}")
            print("Using default configuration")
    
    def _merge_config(self, custom_config: Dict[str, Any]):
        """Merge custom config with default config"""
        for key, value in custom_config.items():
            if key in self.config and isinstance(self.config[key], dict):
                if isinstance(value, dict):
                    self.config[key].update(value)
                else:
                    self.config[key] = value
            else:
                self.config[key] = value
    
    def save_config(self, config_path: Optional[str] = None):
        """Save current configuration to file"""
        path = config_path or self.config_path
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
            print(f"Configuration saved to {path}")
        except Exception as e:
            print(f"Error saving config: {e}")
    
    def add_folder_mapping(self, folder_name: str, metadata: Dict[str, Any]):
        """Add new folder mapping"""
        self.config["folder_mappings"][folder_name] = metadata
    
    def add_query_keywords(self, category: str, item: str, keywords: List[str]):
        """Add new query keywords"""
        if category not in self.config["query_keywords"]:
            self.config["query_keywords"][category] = {}
        self.config["query_keywords"][category][item] = keywords
    
    def get_folder_mapping(self, folder_name: str) -> Dict[str, Any]:
        """Get metadata mapping for a folder"""
        return self.config["folder_mappings"].get(folder_name, {})
    
    def get_query_keywords(self) -> Dict[str, Dict[str, List[str]]]:
        """Get all query keywords"""
        return self.config["query_keywords"]
    
    def get_chunk_settings(self) -> Dict[str, Any]:
        """Get chunk settings"""
        return self.config["chunk_settings"]
    
    def get_default_metadata(self) -> Dict[str, Any]:
        """Get default metadata for root files"""
        return self.config["default_metadata"]


# Global config instance
_metadata_config = None

def get_metadata_config() -> MetadataConfig:
    """Get global metadata configuration instance"""
    global _metadata_config
    if _metadata_config is None:
        _metadata_config = MetadataConfig()
    return _metadata_config

def reload_metadata_config(config_path: Optional[str] = None):
    """Reload metadata configuration"""
    global _metadata_config
    _metadata_config = MetadataConfig(config_path)
    return _metadata_config