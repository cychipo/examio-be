from __future__ import annotations

from src.evaluation.pipeline.code_extractor import extract_code_block


def test_extract_python_fenced_block_prefers_python_tag():
    response = '''
Duoi day la loi giai:

```python
def add(a, b):
    return a + b
```
'''
    extracted = extract_code_block(response, 'python')
    assert extracted.startswith('def add')
    assert 'return a + b' in extracted


def test_extract_python_from_explanation_heavy_response_without_fence():
    response = '''
Here is a possible implementation. It uses a simple loop.

def factorial(n):
    if n == 0:
        return 1
    result = 1
    for value in range(1, n + 1):
        result *= value
    return result

The complexity is O(n).
'''
    extracted = extract_code_block(response, 'python')
    assert extracted.startswith('def factorial')
    assert 'return result' in extracted


def test_extract_c_fenced_block():
    response = '''
```c
#include <stdio.h>

int add(int a, int b) {
    return a + b;
}
```
'''
    extracted = extract_code_block(response, 'c')
    assert extracted.startswith('#include <stdio.h>')
    assert 'int add(int a, int b)' in extracted


def test_extract_c_from_explanation_heavy_response_without_fence():
    response = '''
Duoi day la code C de giai bai toan:

#include <assert.h>

int square(int x) {
    return x * x;
}

int main(void) {
    assert(square(4) == 16);
    return 0;
}

Ban co the bien dich bang gcc.
'''
    extracted = extract_code_block(response, 'c')
    assert extracted.startswith('#include <assert.h>')
    assert 'int square(int x)' in extracted
