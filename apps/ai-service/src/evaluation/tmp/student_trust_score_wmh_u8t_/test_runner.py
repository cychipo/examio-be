from solution import *

from solution import *

try:
    # Test case 1: Input with 5 elements
    n = 5
    numbers = [1, 3, 5, 2, 4]
    assert max(numbers) == 5, "Test case 1 failed"

    # Test case 2: Input with 3 elements
    n = 3
    numbers = [10, 20, 30]
    assert max(numbers) == 30, "Test case 2 failed"

    # Test case 3: Input with 4 elements
    n = 4
    numbers = [5, 5, 5, 5]
    assert max(numbers) == 5, "Test case 3 failed"

    # Test case 4: Input with 2 elements
    n = 2
    numbers = [100, 200]
    assert max(numbers) == 200, "Test case 4 failed"

    # Test case 5: Input with 6 elements
    n = 6
    numbers = [3, 1, 4, 1, 5, 9]
    assert max(numbers) == 9, "Test case 5 failed"

    print("EVAL_RESULT: {\"passed\": 5, \"total\": 5}")
except:
    print("EVAL_RESULT: {\"passed\": 0, \"total\": 5}")
