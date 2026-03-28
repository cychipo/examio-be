from solution import *

from solution import *

# Test case 1: Normal input
assert find_max([3, 1, 4, 1, 5]) == 5

# Test case 2: All elements same
assert find_max([7, 7, 7]) == 7

# Test case 3: Single element
assert find_max([9]) == 9

# Test case 4: Negative numbers
assert find_max([-5, -10, -3]) == -3

# Test case 5: Mixed positive/negative
assert find_max([2, -1, 0, 8]) == 8

print('EVAL_RESULT: {"passed": 5, "total": 5}')
