# OCR Service - File Validation & Size Limits

## File Size Limits

**No file size limits** are enforced in this service. The service can handle PDFs of any size, limited only by:
- Available disk space
- Available memory
- GPU VRAM for olmocr processing
- Timeout settings (default: 5 minutes)

### Configuration

**Python FastAPI Backend:**
- No built-in file size limits
- Uses streaming file upload
- Reads file in chunks

**NestJS gRPC Service:**
```typescript
HttpModule.register({
  timeout: 300000,           // 5 minutes
  maxContentLength: Infinity, // No limit
  maxBodyLength: Infinity,    // No limit
})
```

**gRPC:**
- Default message size: 4MB
- Can be increased via gRPC options if needed
- For very large files (>100MB), consider chunking

## PDF Validation

The service performs **strict PDF validation** with multiple checks:

### 1. Filename Extension Check
```python
if not file.filename.lower().endswith(".pdf"):
    raise HTTPException(400, "File must have .pdf extension")
```

### 2. MIME Type Check
```python
ALLOWED_PDF_MIMES = {
    "application/pdf",
    "application/x-pdf",
}

if content_type not in ALLOWED_PDF_MIMES:
    raise HTTPException(400, f"Invalid content type: {content_type}")
```

### 3. Magic Number (File Signature) Check
```python
with open(file_path, "rb") as f:
    header = f.read(4)
    if header != b"%PDF":
        raise HTTPException(400, "Invalid PDF file signature")
```

## Accepted File Types

**ONLY PDF files are accepted:**
- ✅ `.pdf` files with valid PDF signature
- ✅ MIME type: `application/pdf` or `application/x-pdf`
- ❌ Images (PNG, JPG) - rejected
- ❌ Documents (DOC, DOCX) - rejected
- ❌ Other formats - rejected

**Note:** While olmocr supports images (PNG, JPG), this service is configured to accept **ONLY PDF files** for consistency and security.

## Error Responses

### Invalid File Type
```json
{
  "success": false,
  "error_message": "Only PDF files are accepted",
  "job_id": "",
  "content": "",
  "page_count": 0
}
```

### Invalid PDF Signature
```json
{
  "success": false,
  "error_message": "Invalid PDF file signature",
  "job_id": "",
  "content": "",
  "page_count": 0
}
```

### Invalid MIME Type
```json
{
  "success": false,
  "error_message": "Invalid content type: image/png. Must be application/pdf",
  "job_id": "",
  "content": "",
  "page_count": 0
}
```

## Validation Flow

```
User Upload
    ↓
1. Check filename extension (.pdf)
    ↓
2. Save file to disk
    ↓
3. Check MIME type header
    ↓
4. Read first 4 bytes
    ↓
5. Verify magic number (%PDF)
    ↓
6. If valid → Process
   If invalid → Delete file & return error
```

## Security Considerations

1. **File Extension Check**: Prevents obvious non-PDF files
2. **MIME Type Check**: Validates HTTP header
3. **Magic Number Check**: Verifies actual file content
4. **Immediate Cleanup**: Invalid files are deleted immediately
5. **No Execution**: PDF files are never executed, only parsed

## Timeout Settings

To prevent resource exhaustion:

```python
subprocess.run(
    cmd,
    timeout=300  # 5 minutes max per PDF
)
```

For very large PDFs, consider:
- Increasing timeout in `main.py`
- Processing in batches
- Using async processing

## Recommendations for Large Files

For PDFs > 100MB or > 500 pages:

1. **Increase timeout**:
```python
# In main.py
timeout=600  # 10 minutes
```

2. **Monitor resources**:
```bash
# Check GPU memory
nvidia-smi

# Check disk space
df -h
```

3. **Consider chunking**: Split large PDFs into smaller chunks

## Testing

Test with different file types:

```bash
# Valid PDF - should succeed
curl -X POST http://127.0.0.1:8003/api/ocr/process \
  -F "file=@document.pdf"

# PNG file renamed to .pdf - should fail (magic number check)
curl -X POST http://127.0.0.1:8003/api/ocr/process \
  -F "file=@image.pdf"

# Text file with .pdf extension - should fail
curl -X POST http://127.0.0.1:8003/api/ocr/process \
  -F "file=@fake.pdf"
```
