from solution import *

from solution import *

assert isinstance(n, int), "n should be an integer"
assert isinstance(numbers, list), "numbers should be a list"
assert len(numbers) == n, "numbers length should match n"
assert all(isinstance(x, int) for x in numbers), "All elements in numbers should be integers"

print("EVAL_RESULT:", {"passed": 4, "total": 4})
