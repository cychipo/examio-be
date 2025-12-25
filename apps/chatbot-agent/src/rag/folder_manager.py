# Folder Management Utilities cho Enhanced RAG System

from typing import Dict, List, Any, Optional
import os
from .metadata_config import get_metadata_config, reload_metadata_config

class FolderManager:
    """Utility class để manage folders và metadata mappings"""
    
    def __init__(self):
        self.config = get_metadata_config()
    
    def add_new_department(self, 
                          folder_name: str, 
                          department_vn: str,
                          source_type: str = "custom",
                          subfolders: Optional[Dict[str, Dict[str, str]]] = None):
        """Thêm department mới vào config"""
        
        mapping = {
            "department": folder_name,
            "department_vn": department_vn,
            "source_type": source_type
        }
        
        if subfolders:
            mapping["subfolders"] = subfolders
        
        self.config.add_folder_mapping(folder_name, mapping)
        
        # Add query keywords for the new department
        keywords = [department_vn.lower(), folder_name.lower()]
        self.config.add_query_keywords("departments", folder_name, keywords)
        
        print(f"✅ Added department: {department_vn} ({folder_name})")
        return True
    
    def add_subfolder_to_department(self,
                                   department: str,
                                   subfolder_name: str,
                                   subfolder_vn: str,
                                   metadata_type: str = "level",
                                   keywords: Optional[List[str]] = None):
        """Thêm subfolder vào department existing"""
        
        folder_mapping = self.config.get_folder_mapping(department)
        if not folder_mapping:
            print(f"❌ Department '{department}' not found")
            return False
        
        if "subfolders" not in folder_mapping:
            folder_mapping["subfolders"] = {}
        
        # Create subfolder metadata
        subfolder_metadata = {
            f"{metadata_type}": subfolder_name,
            f"{metadata_type}_vn": subfolder_vn
        }
        
        folder_mapping["subfolders"][subfolder_name] = subfolder_metadata
        
        # Update config
        self.config.add_folder_mapping(department, folder_mapping)
        
        # Add keywords if provided
        if keywords:
            category = f"{metadata_type}s"  # levels -> levels, types -> types
            self.config.add_query_keywords(category, subfolder_name, keywords)
        
        print(f"✅ Added subfolder: {subfolder_vn} ({subfolder_name}) to {department}")
        return True
    
    def scan_data_directory(self, data_dir: str) -> Dict[str, Any]:
        """Scan data directory và suggest metadata mappings cho folders chưa config"""
        
        suggestions = {
            "new_folders": [],
            "existing_folders": [],
            "missing_subfolders": {}
        }
        
        # Get existing mappings
        existing_mappings = self.config.config.get("folder_mappings", {})
        
        # Scan directory structure
        for root, dirs, files in os.walk(data_dir):
            rel_path = os.path.relpath(root, data_dir)
            
            if rel_path == '.':
                # Root level directories
                for dir_name in dirs:
                    if dir_name not in existing_mappings:
                        suggestions["new_folders"].append({
                            "folder_name": dir_name,
                            "suggested_vn": dir_name.title(),
                            "path": dir_name
                        })
                    else:
                        suggestions["existing_folders"].append(dir_name)
            
            else:
                # Check subfolders
                path_parts = rel_path.split(os.sep)
                if len(path_parts) == 2:  # department/subfolder level
                    department = path_parts[0]
                    subfolder = path_parts[1]
                    
                    if department in existing_mappings:
                        dept_config = existing_mappings[department]
                        existing_subfolders = dept_config.get("subfolders", {})
                        
                        if subfolder not in existing_subfolders:
                            if department not in suggestions["missing_subfolders"]:
                                suggestions["missing_subfolders"][department] = []
                            
                            suggestions["missing_subfolders"][department].append({
                                "subfolder_name": subfolder,
                                "suggested_vn": subfolder.title(),
                                "path": f"{department}/{subfolder}"
                            })
        
        return suggestions
    
    def auto_configure_from_scan(self, data_dir: str, confirm: bool = False):
        """Tự động configure folders từ scan results"""
        
        suggestions = self.scan_data_directory(data_dir)
        
        print("🔍 Scan Results:")
        print(f"New folders found: {len(suggestions['new_folders'])}")
        print(f"Missing subfolders: {sum(len(v) for v in suggestions['missing_subfolders'].values())}")
        
        if not confirm:
            print("\n📋 Suggestions:")
            for folder in suggestions["new_folders"]:
                print(f"  📁 {folder['folder_name']} -> {folder['suggested_vn']}")
            
            for dept, subfolders in suggestions["missing_subfolders"].items():
                print(f"  📁 {dept}:")
                for sub in subfolders:
                    print(f"    📂 {sub['subfolder_name']} -> {sub['suggested_vn']}")
            
            print("\n💡 Call with confirm=True to apply these changes")
            return suggestions
        
        # Apply suggestions
        for folder in suggestions["new_folders"]:
            self.add_new_department(
                folder["folder_name"],
                folder["suggested_vn"],
                "auto_detected"
            )
        
        for dept, subfolders in suggestions["missing_subfolders"].items():
            for sub in subfolders:
                self.add_subfolder_to_department(
                    dept,
                    sub["subfolder_name"], 
                    sub["suggested_vn"],
                    "custom_level"
                )
        
        return suggestions
    
    def save_config(self, backup: bool = True):
        """Save config với optional backup"""
        if backup:
            backup_path = self.config.config_path + ".backup"
            import shutil
            if os.path.exists(self.config.config_path):
                shutil.copy2(self.config.config_path, backup_path)
                print(f"📄 Backup saved to: {backup_path}")
        
        self.config.save_config()
        print("💾 Configuration saved!")
    
    def reload_config(self):
        """Reload configuration"""
        self.config = reload_metadata_config()
        print("🔄 Configuration reloaded!")
    
    def print_current_config(self):
        """Print current configuration in readable format"""
        print("📊 Current Configuration:")
        print("=" * 50)
        
        folder_mappings = self.config.config.get("folder_mappings", {})
        
        for folder_name, config in folder_mappings.items():
            dept_vn = config.get("department_vn", folder_name)
            source_type = config.get("source_type", "unknown")
            
            print(f"📁 {folder_name} ({dept_vn}) - Type: {source_type}")
            
            subfolders = config.get("subfolders", {})
            for sub_name, sub_config in subfolders.items():
                sub_vn = sub_config.get("education_level_vn") or sub_config.get("custom_level_vn", sub_name)
                print(f"  📂 {sub_name} ({sub_vn})")
        
        print("=" * 50)


# Convenience functions
def add_department(folder_name: str, department_vn: str, source_type: str = "custom"):
    """Quick function để thêm department mới"""
    manager = FolderManager()
    return manager.add_new_department(folder_name, department_vn, source_type)

def scan_and_suggest(data_dir: str = "./data"):
    """Quick function để scan và suggest new folders"""
    manager = FolderManager()
    return manager.scan_data_directory(data_dir)

def auto_configure(data_dir: str = "./data", confirm: bool = False):
    """Quick function để auto-configure folders"""
    manager = FolderManager()
    return manager.auto_configure_from_scan(data_dir, confirm)

def print_config():
    """Quick function để print current config"""
    manager = FolderManager()
    manager.print_current_config()

# Example usage functions
def example_add_new_departments():
    """Ví dụ thêm departments mới"""
    manager = FolderManager()
    
    # Thêm Phòng KHCN với subfolders
    manager.add_new_department(
        "phongkhcn", 
        "Phòng KHCN",
        "research",
        {
            "detai": {
                "research_type": "project",
                "research_type_vn": "đề tài"
            },
            "baibao": {
                "research_type": "publication",
                "research_type_vn": "bài báo"
            }
        }
    )
    
    # Thêm Phòng TCCB
    manager.add_new_department(
        "phongtccb",
        "Phòng TCCB", 
        "hr"
    )
    
    manager.save_config()

if __name__ == "__main__":
    # Test the folder manager
    print("🧪 Testing FolderManager...")
    
    # Print current config
    print_config()
    
    # Scan for new folders
    suggestions = scan_and_suggest()
    print("\n📋 Scan suggestions:", suggestions)