#!/usr/bin/env python3
"""
Build Department-Specific Document Graphs
Xây dựng graph riêng biệt cho từng phòng ban thay vì 1 graph chung
"""
import sys
import os
import time

# Add src to path
project_root = os.path.dirname(os.path.abspath(__file__))
src_path = os.path.join(project_root, 'src')
if src_path not in sys.path:
    sys.path.insert(0, src_path)

from rag.table_aware_chunking import load_documents_from_folder
from graph_rag.department_graph_manager import DepartmentGraphManager

print("=" * 80)
print("🏢 BUILDING DEPARTMENT-SPECIFIC DOCUMENT GRAPHS")
print("=" * 80)
print("Mỗi phòng ban sẽ có graph riêng, tránh nhiễu từ phòng ban khác")
print("User chỉ query trong graph của phòng ban tương ứng")
print()

# Path configurations
data_folder = os.path.join(project_root, "data")
output_folder = os.path.join(project_root, "department_graphs")

# Load tất cả documents
print(f"📁 Loading documents from: {data_folder}")
print("   Using enhanced table-aware chunking:")
print("   - Auto-detection of markdown tables")
print("   - Table preservation")
print("   - Vietnamese legal document structure awareness")
print("   - Department classification from file paths")
print()

start_time = time.time()
documents = load_documents_from_folder(
    data_folder=data_folder,
    chunk_size=800,
    chunk_overlap=200
)
load_time = time.time() - start_time

print(f"✅ Loaded {len(documents)} document chunks in {load_time:.2f}s")

# Count special chunks
table_chunks = sum(1 for doc in documents if doc.metadata.get('contains_table', False))
if table_chunks > 0:
    print(f"   📊 {table_chunks} chunks contain markdown tables")
    print(f"   📝 {len(documents) - table_chunks} regular text chunks")

# Analyze document distribution by department
print("\n📊 Analyzing document distribution by department...")
dept_manager = DepartmentGraphManager(output_folder)

# Count documents per department
dept_counts = {}
for doc in documents:
    # Use full_path if available, fallback to source
    source_path = doc.metadata.get('full_path', doc.metadata.get('source', ''))
    dept = dept_manager.detect_department_from_path(source_path)
    dept_counts[dept] = dept_counts.get(dept, 0) + 1

print("   Documents by department (before building graphs):")
for dept, count in sorted(dept_counts.items()):
    print(f"   📁 {dept}: {count} documents")

# Build department-specific graphs
print(f"\n🔨 Building department-specific graphs...")
print("   Settings per department:")
print("   - semantic_threshold=0.7 (balanced connectivity)")
print("   - max_edges=7 (rich connections)")
print("   - Louvain community detection")
print()

start_time = time.time()
department_stats = dept_manager.build_department_graphs(documents)
graph_build_time = time.time() - start_time

print(f"\n✅ Department graphs built in {graph_build_time:.2f}s")

# Test loading graphs
print(f"\n🔍 Testing graph loading...")
test_manager = DepartmentGraphManager(output_folder)
load_success = test_manager.load_existing_graphs()

if load_success:
    print("✅ Graph loading test successful!")
    
    # Show final statistics
    final_stats = test_manager.get_department_stats()
    print(f"\n📊 Final Department Graph Statistics:")
    
    total_nodes = sum(stat['nodes'] for stat in final_stats.values())
    total_edges = sum(stat['edges'] for stat in final_stats.values())
    total_communities = sum(stat['communities'] for stat in final_stats.values())
    
    print(f"   🏢 Total departments: {len(final_stats)}")
    print(f"   📈 Total nodes: {total_nodes}")
    print(f"   📈 Total edges: {total_edges}")
    print(f"   🏘️  Total communities: {total_communities}")
    print()
    
    for dept, stats in final_stats.items():
        nodes = stats.get('nodes', 0)
        edges = stats.get('edges', 0)
        avg_degree = (2 * edges / nodes) if nodes > 0 else 0
        print(f"   📁 {dept}:")
        print(f"      - Nodes: {nodes}")
        print(f"      - Edges: {edges}")
        print(f"      - Communities: {stats.get('communities', 0)}")
        print(f"      - Avg degree: {avg_degree:.2f}")
    
    # Test smart query
    print(f"\n🧪 Testing smart query functionality...")
    test_queries = [
        "Quy định về điểm TOEIC cần thiết để tốt nghiệp",
        "Chương trình đào tạo ngành ATTT", 
        "Quy trình nghiên cứu khoa học",
        "Thông tin về Học viện Kỹ thuật mật mã"
    ]
    
    for query in test_queries:
        print(f"\n🔍 Test query: {query}")
        target_depts = test_manager.detect_department_from_query(query, top_k=2)
        print(f"   🎯 Detected departments: {target_depts}")
        
        # Test actual retrieval
        results = test_manager.query_smart(query, k=2)
        print(f"   📄 Retrieved {len(results)} documents")
        
        if isinstance(results, list) and len(results) > 0:
            for i, doc in enumerate(results):
                if hasattr(doc, 'metadata'):
                    dept = doc.metadata.get('query_department', 'unknown')
                    source = os.path.basename(doc.metadata.get('source', 'unknown'))
                    print(f"      {i+1}. [{dept}] {source} (score: {doc.metadata.get('combined_score', 0):.3f})")
                else:
                    print(f"      {i+1}. Unexpected result type: {type(doc)}")
        else:
            print(f"      No valid documents retrieved")

else:
    print("❌ Graph loading test failed!")

print("\n" + "=" * 80)
print("✅ DEPARTMENT GRAPH BUILDING COMPLETE!")
print("=" * 80)
print(f"Total time: {load_time + graph_build_time:.2f}s")
print(f"  - Document loading: {load_time:.2f}s")
print(f"  - Graph building: {graph_build_time:.2f}s")
print(f"Graphs saved to: {output_folder}")
print()
print("🎯 Usage:")
print("   1. Load graphs: manager = DepartmentGraphManager(); manager.load_department_graphs()")
print("   2. Smart query: results = manager.query_smart('your question', user_department='phongdaotao')")
print("   3. Specific dept: results = manager.query_department('question', 'phongkhaothi')")