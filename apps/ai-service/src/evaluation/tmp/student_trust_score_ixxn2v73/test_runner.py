from solution import *

from solution import *

# Test case 1: n=3, numbers 1 2 3
import sys
from io import StringIO

def test1():
    sys.stdin = StringIO("3\n1 2 3")
    try:
        main()
        output = sys.stdout.getvalue().strip()
        assert output == "Số lớn nhất là: 3"
    finally:
        sys.stdin = sys.__stdin__

# Test case 2: n=5, numbers 5 4 3 2 1
def test2():
    sys.stdin = StringIO("5\n5 4 3 2 1")
    try:
        main()
        output = sys.stdout.getvalue().strip()
        assert output == "Số lớn nhất là: 5"
    finally:
        sys.stdin = sys.__stdin__

# Test case 3: n=4, numbers 10 20 30 40
def test3():
    sys.stdin = StringIO("4\n10 20 30 40")
    try:
        main()
        output = sys.stdout.getvalue().strip()
        assert output == "Số lớn nhất là: 40"
    finally:
        sys.stdin = sys.__stdin__

# Run tests
try:
    test1()
    test2()
    test3()
    print("EVAL_RESULT: {\"passed\": 3, \"total\": 3}")
except AssertionError as e:
    print(f"EVAL_RESULT: {{\"passed\": 0, \"total\": 3}}")
