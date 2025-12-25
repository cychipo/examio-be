"""
Table-Aware Chunking for GraphRAG
Enhanced chunking that preserves markdown tables and Vietnamese legal structure
Copied from graph_routed_rag for GraphRAG integration
"""

import re
import glob
import os
from typing import List, Dict, Any, Tuple
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter


def is_legal_document(content: str) -> bool:
    """Check if content is a Vietnamese legal/regulation document"""
    legal_patterns = [
        r'Điều \d+\.',
        r'Khoản \d+\.',
        r'QUY ĐỊNH|QUY CHẾ|QUYẾT ĐỊNH',
        r'Ban hành|Căn cứ'
    ]
    return any(re.search(pattern, content, re.IGNORECASE) for pattern in legal_patterns)


def detect_markdown_tables(text: str) -> List[Dict[str, Any]]:
    """
    Detect markdown tables in text and return their positions
    IMPROVED: Stricter table detection to avoid false positives
    
    Returns:
        List of dicts with 'start', 'end', 'content', 'header_lines' for each table
    """
    tables = []
    lines = text.split('\n')
    i = 0
    
    while i < len(lines):
        line = lines[i].strip()
        
        # STRICTER: Check if line is a proper table separator
        # Must have at least 2 columns and proper separator format
        if ('|' in line and 
            re.search(r'\|\s*[-:]+\s*\|', line) and  # Proper separator with dashes/colons
            line.count('|') >= 3):  # At least 2 columns (3 pipes)
            
            # Look back for header (previous line with similar pipe count)
            if (i > 0 and 
                '|' in lines[i-1] and 
                abs(lines[i-1].count('|') - line.count('|')) <= 1):  # Similar column count
                
                # Validate it's actually a table by checking structure
                header_line = lines[i-1].strip()
                if (not header_line.startswith('#') and  # Not a heading
                    '|' in header_line and 
                    len(header_line.split('|')) >= 3):  # Proper header structure
                    
                    # Found valid table! Collect all table rows
                    table_start = i - 1
                    table_end = i + 1
                
                    # Collect following rows that are part of table
                    table_row_count = 0
                    while (table_end < len(lines) and 
                           '|' in lines[table_end] and 
                           table_row_count < 50):  # Limit table size
                        # Validate row structure matches header
                        row_pipe_count = lines[table_end].count('|')
                        if abs(row_pipe_count - line.count('|')) <= 1:
                            table_end += 1
                            table_row_count += 1
                        else:
                            break  # Not a table row
                    
                    # Look for context before table (up to 2 lines)
                    context_start = max(0, table_start - 2)
                    header_lines = []
                    for j in range(context_start, table_start):
                        line_text = lines[j].strip()
                        # Include lines that describe the table (Bảng X, Table X, etc.)
                        if line_text and ('bảng' in line_text.lower() or 'table' in line_text.lower() or line_text.startswith('#')):
                            header_lines.append(line_text)
                
                # Extract table content with context
                table_content_lines = header_lines + lines[table_start:table_end]
                table_content = '\n'.join(table_content_lines)
                
                tables.append({
                    'start': context_start if header_lines else table_start,
                    'end': table_end,
                    'content': table_content,
                    'header_lines': len(header_lines)
                })
                
                # Skip past this table
                i = table_end
                continue
        
        i += 1
    
    return tables


def split_text_with_table_preservation(text: str, chunk_size: int = 800, chunk_overlap: int = 200) -> List[str]:
    """
    Split text into chunks while keeping markdown tables intact
    
    Strategy:
    1. Detect all markdown tables
    2. Split text around tables (tables become their own chunks)
    3. Split non-table text normally
    """
    # Detect tables with improved validation
    tables = detect_markdown_tables(text)
    
    # IMPROVEMENT: Validate table detection results
    # If too many tables detected (likely false positives), fall back to normal splitting
    total_table_chars = sum(len(table['content']) for table in tables)
    table_coverage = total_table_chars / len(text) if text else 0
    
    if not tables or table_coverage > 0.8:  # If >80% is "tables", likely false positive
        if table_coverage > 0.8:
            print(f"   ⚠️  Table coverage too high ({table_coverage:.1%}) - likely false positive, using normal split")
        
        # No tables found or too many false positives, use standard splitting
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
            separators=["\n\n", "\n", ". ", " ", ""],
            keep_separator=False
        )
        return text_splitter.split_text(text)
    
    # Split text into segments: [text_before_table1, table1, text_between_tables, table2, ...]
    lines = text.split('\n')
    chunks = []
    last_end = 0
    
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=["\n\n", "\n", ". ", " ", ""],
        keep_separator=False
    )
    
    for table in tables:
        # Text before table
        if last_end < table['start']:
            text_before = '\n'.join(lines[last_end:table['start']])
            if text_before.strip():
                # Split normally
                chunks.extend(text_splitter.split_text(text_before))
        
        # Table itself (keep intact if reasonable size, otherwise split)
        table_chunk = table['content']
        if len(table_chunk) > chunk_size * 2:
            # Table is very large, need to split it
            print(f"⚠️  Warning: Large table detected ({len(table_chunk)} chars). Splitting into smaller chunks.")
            # Split large table by rows while preserving header
            table_lines = table_chunk.split('\n')
            header_lines = []
            data_lines = []
            
            # Find header and separator
            for i, line in enumerate(table_lines):
                if '|' in line and re.search(r'\|[\s-]+\|', line):
                    # This is separator, everything before is header
                    header_lines = table_lines[:i+1]
                    data_lines = table_lines[i+1:]
                    break
            
            if header_lines and data_lines:
                # Split data rows into chunks
                current_table_chunk = '\n'.join(header_lines)
                
                for data_line in data_lines:
                    if len(current_table_chunk + '\n' + data_line) > chunk_size:
                        # Current chunk is full, save it
                        if current_table_chunk.strip():
                            chunks.append(current_table_chunk)
                        # Start new chunk with header
                        current_table_chunk = '\n'.join(header_lines) + '\n' + data_line
                    else:
                        current_table_chunk += '\n' + data_line
                
                # Add remaining chunk
                if current_table_chunk.strip() and current_table_chunk != '\n'.join(header_lines):
                    chunks.append(current_table_chunk)
            else:
                # No proper table structure, just split by lines
                chunks.extend(text_splitter.split_text(table_chunk))
        else:
            # Small table, keep intact
            chunks.append(table_chunk)
        
        last_end = table['end']
    
    # Text after last table
    if last_end < len(lines):
        text_after = '\n'.join(lines[last_end:])
        if text_after.strip():
            chunks.extend(text_splitter.split_text(text_after))
    
    return chunks


def split_by_vietnamese_structure(content: str, chunk_settings: Dict[str, Any]) -> List[str]:
    """
    Split Vietnamese legal documents by structural units (Điều, Chương, Mục)
    Keeps complete logical units together within size limits.
    """
    max_chunk_size = chunk_settings.get('max_chunk_size', 1500)
    min_chunk_size = chunk_settings.get('min_chunk_size', 500)
    overlap_size = chunk_settings.get('overlap_size', 300)
    
    # Extract all Điều sections using split
    dieu_pattern = r'(##?\s*Điều\s+\d+\.?\s*[^\n]+)'
    parts = re.split(dieu_pattern, content)
    
    if len(parts) <= 1:
        return [content]
    
    # Reconstruct Điều sections
    dieu_sections = []
    for i in range(1, len(parts), 2):
        if i < len(parts):
            header = parts[i]
            content_part = parts[i+1] if i+1 < len(parts) else ""
            full_dieu = header + content_part
            dieu_sections.append(full_dieu.strip())
    
    if not dieu_sections:
        return [content]
    
    chunks = []
    current_chunk = ""
    
    for dieu_text in dieu_sections:
        if not dieu_text:
            continue
        
        # If this Điều can fit in current chunk, add it
        if len(current_chunk + "\n\n" + dieu_text) <= max_chunk_size:
            if current_chunk:
                current_chunk += "\n\n" + dieu_text
            else:
                current_chunk = dieu_text
        else:
            # Save current chunk if it has content
            if current_chunk.strip() and len(current_chunk) >= min_chunk_size:
                chunks.append(current_chunk)
            
            # Check if this Điều alone is too large
            if len(dieu_text) > max_chunk_size:
                # Split large Điều by khoản
                sub_chunks = split_large_dieu_by_khoan(dieu_text, max_chunk_size, min_chunk_size)
                chunks.extend(sub_chunks)
                current_chunk = ""
            else:
                current_chunk = dieu_text
    
    # Add remaining chunk
    if current_chunk.strip():
        chunks.append(current_chunk)
    
    # Add overlap
    if len(chunks) > 1:
        chunks = add_overlap_to_chunks(chunks, overlap_size)
    
    return chunks if chunks else [content]


def split_large_dieu_by_khoan(dieu_text: str, max_size: int, min_size: int) -> List[str]:
    """Split a large Điều section by khoản (clauses)"""
    khoan_pattern = r'(?:^|\n)(\d+\.(?:\s|$))'
    khoan_splits = re.split(khoan_pattern, dieu_text, flags=re.MULTILINE)
    
    if len(khoan_splits) <= 1:
        return [dieu_text]
    
    chunks = []
    current_chunk = khoan_splits[0]
    
    for i in range(1, len(khoan_splits), 2):
        if i + 1 < len(khoan_splits):
            khoan_marker = khoan_splits[i]
            khoan_content = khoan_splits[i + 1]
            khoan_full = khoan_marker + khoan_content
            
            if len(current_chunk + khoan_full) <= max_size:
                current_chunk += khoan_full
            else:
                if current_chunk.strip():
                    chunks.append(current_chunk)
                current_chunk = khoan_full
    
    if current_chunk.strip():
        chunks.append(current_chunk)
    
    return chunks


def add_overlap_to_chunks(chunks: List[str], overlap_size: int) -> List[str]:
    """Add overlap from previous chunk to each subsequent chunk"""
    if len(chunks) <= 1:
        return chunks
    
    overlapped_chunks = [chunks[0]]
    
    for i in range(1, len(chunks)):
        prev_chunk = chunks[i-1]
        curr_chunk = chunks[i]
        
        # Get last overlap_size chars from previous chunk
        overlap = get_last_n_chars(prev_chunk, overlap_size)
        
        # Prepend overlap to current chunk
        overlapped_chunk = overlap + "\n\n" + curr_chunk
        overlapped_chunks.append(overlapped_chunk)
    
    return overlapped_chunks


def get_last_n_chars(text: str, n: int) -> str:
    """Get last n characters, preferring complete sentences"""
    if len(text) <= n:
        return text
    
    last_part = text[-n:]
    
    # Find first sentence boundary in the overlap region
    sentence_breaks = [m.start() for m in re.finditer(r'[.!?]\s+', last_part)]
    if sentence_breaks:
        return last_part[sentence_breaks[0]+2:]
    
    return last_part


def ensure_chunk_overlap(chunks: List[str], target_overlap: int) -> List[str]:
    """Ensure chunks have actual overlap by post-processing"""
    if len(chunks) <= 1:
        return chunks
    
    enhanced_chunks = []
    
    for i, chunk in enumerate(chunks):
        if i == 0:
            enhanced_chunks.append(chunk)
        else:
            prev_chunk = chunks[i-1]
            overlap_text = prev_chunk[-target_overlap:] if len(prev_chunk) > target_overlap else prev_chunk
            
            if len(overlap_text) == target_overlap:
                last_space = overlap_text.rfind(' ')
                if last_space > target_overlap // 2:
                    overlap_text = overlap_text[last_space+1:]
            
            enhanced_chunk = overlap_text + "\n" + chunk
            enhanced_chunks.append(enhanced_chunk)
    
    return enhanced_chunks


def force_split_large_content(content: str, chunk_size: int = 1500, chunk_overlap: int = 300) -> List[str]:
    """
    Force split large content into manageable chunks, ignoring table preservation
    Used for very large files (like textbooks) that would otherwise become single giant chunks
    
    Args:
        content: Large text content
        chunk_size: Target chunk size (larger for big files)
        chunk_overlap: Overlap between chunks
        
    Returns:
        List of text chunks
    """
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    
    # Use aggressive splitting with multiple separators
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=[
            "\n\n## ",  # Major sections
            "\n\n# ",   # Headers
            "\n\n",     # Paragraphs
            "\n",       # Lines
            ". ",       # Sentences
            " ",        # Words
            ""
        ],
        keep_separator=True
    )
    
    chunks = splitter.split_text(content)
    print(f"   → Force split into {len(chunks)} chunks (avg {sum(len(c) for c in chunks)/len(chunks):.0f} chars each)")
    return chunks


def enhanced_text_chunking(content: str, chunk_settings: Dict[str, Any]) -> List[str]:
    """
    Enhanced chunking with table preservation và Vietnamese legal structure awareness
    IMPROVED: Size-based fallback for very large files
    
    Strategy:
    1. Check if file is too large - if so, force split regardless of tables
    2. Detect tables and preserve them intact (with stricter validation)
    3. Use Vietnamese legal structure for legal documents (Điều/Khoản)
    4. Use recursive splitting for regular text
    
    Args:
        content: Text content to chunk
        chunk_settings: Settings dict with chunk_size, chunk_overlap, etc.
        
    Returns:
        List of text chunks
    """
    chunk_size = chunk_settings.get('chunk_size', 800)
    chunk_overlap = chunk_settings.get('chunk_overlap', 200)
    max_chunk_size = chunk_settings.get('max_chunk_size', 1500)
    
    # IMPROVEMENT: Force split for very large files (>100KB)
    if len(content) > 100000:  # 100KB threshold
        print(f"📄 Large file ({len(content)} chars) - forcing split to avoid single giant chunk")
        return force_split_large_content(content, chunk_size=1500, chunk_overlap=300)
    
    # Check if it's a legal document
    if is_legal_document(content):
        return vietnamese_legal_chunking_with_tables(content, chunk_size, chunk_overlap)
    
    # Use table-aware chunking with improved detection
    return split_text_with_table_preservation(content, chunk_size, chunk_overlap)


# Removed duplicate function - using the one at line 15 instead


def vietnamese_legal_chunking_with_tables(content: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    """
    Chunk Vietnamese legal documents by preserving both legal structure (Điều/Khoản/Điểm) AND tables
    
    Args:
        content: Legal document content
        chunk_size: Target chunk size
        chunk_overlap: Overlap between chunks
        
    Returns:
        List of text chunks respecting both legal structure and table preservation
    """
    # First detect and extract tables
    tables = detect_markdown_tables(content)
    
    if not tables:
        # No tables, use regular legal chunking
        return vietnamese_legal_chunking_original(content, chunk_size, chunk_overlap)
    
    # Process content with table preservation
    chunks = []
    last_end = 0
    
    for table_info in tables:
        table_start = table_info['start']
        table_end = table_info['end']
        
        # Process text before table with legal chunking
        if table_start > last_end:
            text_before = content[last_end:table_start].strip()
            if text_before:
                legal_chunks = vietnamese_legal_chunking_original(text_before, chunk_size, chunk_overlap)
                chunks.extend(legal_chunks)
        
        # Add table as single chunk (with size check)
        table_content = table_info['content']
        if len(table_content) > chunk_size * 2:
            # Table too large, try to split by rows while preserving structure
            table_chunks = split_large_table(table_content, chunk_size)
            chunks.extend(table_chunks)
        else:
            chunks.append(table_content)
        
        last_end = table_end
    
    # Process remaining text after last table
    if last_end < len(content):
        remaining_text = content[last_end:].strip()
        if remaining_text:
            legal_chunks = vietnamese_legal_chunking_original(remaining_text, chunk_size, chunk_overlap)
            chunks.extend(legal_chunks)
    
    return chunks


def split_large_table(table_content: str, chunk_size: int) -> List[str]:
    """Split large table while preserving header and structure"""
    lines = table_content.split('\n')
    
    # Find header and separator
    header_lines = []
    data_start = 0
    
    for i, line in enumerate(lines):
        if '|' in line and re.search(r'\|\s*[-:]+\s*\|', line):
            # This is separator line, header is everything before + separator
            header_lines = lines[:i+1]
            data_start = i + 1
            break
    
    if not header_lines:
        # No proper table structure, split normally
        return [table_content]
    
    # Split data rows into chunks
    header_text = '\n'.join(header_lines)
    chunks = []
    current_chunk = header_text
    
    for i in range(data_start, len(lines)):
        line = lines[i]
        if len(current_chunk + '\n' + line) > chunk_size and len(current_chunk) > len(header_text):
            chunks.append(current_chunk)
            current_chunk = header_text + '\n' + line
        else:
            current_chunk += '\n' + line
    
    if current_chunk.strip():
        chunks.append(current_chunk)
    
    return chunks


def vietnamese_legal_chunking_original(content: str, chunk_size: int, chunk_overlap: int) -> List[str]:
    """
    Chunk Vietnamese legal documents by preserving legal structure (Điều/Khoản/Điểm)
    
    Args:
        content: Legal document content
        chunk_size: Target chunk size
        chunk_overlap: Overlap between chunks
        
    Returns:
        List of text chunks respecting legal structure
    """
    # Split by Điều (Articles)
    dieu_pattern = r'(?:^|\n)(Điều\s+\d+[^\n]*)'
    parts = re.split(dieu_pattern, content, flags=re.MULTILINE)
    
    chunks = []
    current_chunk = ""
    min_chunk_size = chunk_size // 2
    max_chunk_size = chunk_size * 2
    
    for i, part in enumerate(parts):
        if not part.strip():
            continue
            
        # Check if this part is a Điều header
        if re.match(r'Điều\s+\d+', part.strip()):
            # This is a Điều header, combine with next part (content)
            if i + 1 < len(parts):
                dieu_content = part + "\n" + parts[i + 1] if i + 1 < len(parts) else part
            else:
                dieu_content = part
            
            # Check if adding this Điều would exceed max size
            if len(current_chunk + dieu_content) > max_chunk_size:
                # Save current chunk if it has content
                if current_chunk.strip() and len(current_chunk) >= min_chunk_size:
                    chunks.append(current_chunk.strip())
                
                # Start new chunk with this Điều
                current_chunk = dieu_content
            else:
                # Add to current chunk
                current_chunk += "\n\n" + dieu_content if current_chunk else dieu_content
        else:
            # This is content, might already be handled above
            continue
    
    # Add final chunk
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    # If no structure found, fall back to regular chunking
    if len(chunks) <= 1:
        from langchain_text_splitters import RecursiveCharacterTextSplitter
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
            separators=["\n\n", "\n", ". ", " ", ""]
        )
        return splitter.split_text(content)
    
    return chunks


def force_split_large_content(content: str, chunk_size: int = 1500, chunk_overlap: int = 300) -> List[str]:
    """
    Force split large content into manageable chunks, ignoring table preservation
    Used for very large files (like textbooks) that would otherwise become single giant chunks
    
    Args:
        content: Large text content
        chunk_size: Target chunk size (larger for big files)
        chunk_overlap: Overlap between chunks
        
    Returns:
        List of text chunks
    """
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    
    # Use aggressive splitting with multiple separators
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
        separators=[
            "\n\n## ",  # Major sections
            "\n\n# ",   # Headers
            "\n\n",     # Paragraphs
            "\n",       # Lines
            ". ",       # Sentences
            " ",        # Words
            ""
        ],
        keep_separator=True
    )
    
    chunks = splitter.split_text(content)
    print(f"   → Force split into {len(chunks)} chunks (avg {sum(len(c) for c in chunks)/len(chunks):.0f} chars each)")
    return chunks


def enhanced_text_chunking_old(content: str, chunk_settings: Dict[str, Any]) -> List[str]:
    """
    Structure-aware chunking that respects Vietnamese document structure
    - Keeps complete Điều (articles) together when possible
    - Preserves khoản (clauses) and điểm (points) hierarchy
    - Uses semantic boundaries instead of hard character limits
    """
    # Try structure-aware chunking first for Vietnamese legal documents
    if is_legal_document(content):
        chunks = split_by_vietnamese_structure(content, chunk_settings)
        if chunks:
            return chunks
    
    # Fallback to enhanced recursive chunking
    separators = [
        "\n\n\n",
        "\n\n",
        "\n",
        ". ",
        ".",
        "; ",
        ", ",
        " ",
        "",
    ]
    
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_settings.get('chunk_size', 1200),
        chunk_overlap=max(300, chunk_settings.get('chunk_overlap', 300)),
        length_function=len,
        separators=separators,
        keep_separator=True,
        is_separator_regex=False
    )
    
    chunks = text_splitter.split_text(content)
    
    # Post-process to ensure overlap
    if len(chunks) > 1:
        chunks = ensure_chunk_overlap(chunks, chunk_settings.get('chunk_overlap', 300))
    
    return chunks


def load_documents_from_folder(data_folder: str, chunk_size: int = 800, chunk_overlap: int = 200) -> List[Document]:
    """
    Load all .txt/.md documents from a folder recursively with enhanced chunking
    - Structure-aware chunking for Vietnamese legal documents (Điều/khoản)
    - Markdown table preservation
    - Standard recursive chunking for other documents
    
    Args:
        data_folder: Path to folder containing documents
        chunk_size: Size of text chunks (default 800)
        chunk_overlap: Overlap between chunks
        
    Returns:
        List of Document objects with metadata
    """
    # Import here to avoid circular dependency
    import sys
    import os
    
    # Add parent directory to path if needed
    current_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(current_dir)
    if parent_dir not in sys.path:
        sys.path.insert(0, parent_dir)
    
    from rag.metadata_config import get_metadata_config
    from rag.retriever import extract_metadata_from_path
    
    documents = []
    
    chunk_settings = {
        'chunk_size': chunk_size,
        'chunk_overlap': chunk_overlap,
        'max_chunk_size': 1500,
        'min_chunk_size': 500,
        'overlap_size': 300
    }
    
    # Find all text files
    txt_files = []
    for pattern in ["*.txt", "*.md", "*.markdown"]:
        txt_files.extend(glob.glob(os.path.join(data_folder, "**", pattern), recursive=True))
    
    print(f"Found {len(txt_files)} text files in {data_folder}")
    
    for file_path in txt_files:
        try:
            # Read file content
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Extract metadata
            metadata = extract_metadata_from_path(file_path, data_folder)
            metadata['source'] = os.path.basename(file_path)
            metadata['full_path'] = file_path  # Preserve full path for department detection
            
            # Check if file is markdown
            is_markdown = file_path.lower().endswith(('.md', '.markdown'))
            
            # Use enhanced chunking
            chunks = enhanced_text_chunking(content, chunk_settings)
            
            # Log chunking type
            if is_legal_document(content):
                print(f"📜 Vietnamese legal chunking: {os.path.basename(file_path)} -> {len(chunks)} chunks")
            elif is_markdown and '|' in content:
                print(f"📊 Table-aware chunking: {os.path.basename(file_path)} -> {len(chunks)} chunks")
            
            # Create Document objects
            for i, chunk in enumerate(chunks):
                chunk_metadata = metadata.copy()
                chunk_metadata['chunk_index'] = i
                chunk_metadata['total_chunks'] = len(chunks)
                
                # Mark if chunk contains table
                if '|' in chunk and re.search(r'\|[\s-]+\|', chunk):
                    chunk_metadata['contains_table'] = True
                
                doc = Document(
                    page_content=chunk,
                    metadata=chunk_metadata
                )
                documents.append(doc)
        
        except Exception as e:
            print(f"Error loading {file_path}: {e}")
            continue
    
    print(f"Loaded {len(documents)} document chunks")
    return documents
