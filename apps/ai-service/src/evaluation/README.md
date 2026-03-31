# Evaluation Module

Module nay danh cho benchmark va danh gia AI Tutor cho bai toan lap trinh C/Python.

## De xuat cau truc thu muc

```text
src/evaluation/
  README.md
  requirements.txt
  config/
    __init__.py
    settings.py
  datasets/
    __init__.py
    loaders/
      __init__.py
      humaneval_loader.py
      mbpp_loader.py
    schemas.py
    samples/
      .gitkeep
  sandbox/
    __init__.py
    executor.py
    models.py
    utils.py
  metrics/
    __init__.py
    pass_at_k.py
    codebleu.py
  clients/
    __init__.py
    tutor_client.py
  pipeline/
    __init__.py
    benchmark_runner.py
    report_writer.py
  scripts/
    run_benchmark.py
  docker/
    Dockerfile.evaluation
    entrypoint.sh
  reports/
    .gitkeep
  tmp/
    .gitkeep
```

## Nguyen tac dat module

- Dat ben trong `apps/ai-service/src/evaluation` de tai su dung duoc model client, config va runtime Python san co.
- Tach ro `sandbox`, `datasets`, `metrics`, `pipeline` de de test va thay doi ve sau.
- `docker/` dung cho moi truong benchmark rieng, co ca `python3` va `gcc`.
- Runtime tmp/report khi chay that nen dat ngoai `src/` de tranh trigger auto-reload trong che do dev.

## Lo trinh tiep theo

1. Tao settings va data model cho benchmark.
2. Dung loader cho HumanEval va MBPP.
3. Dung execution sandbox cho Python/C.
4. Dung tutor client de goi AI tutor service.
5. Dung benchmark runner va report writer.

## Ghi chu ve code khung hien tai

- `sandbox/executor.py` da co khung chay Python va compile/run C bang `gcc`.
- `datasets/loaders/` da co loader HumanEval va MBPP co ban.
- `metrics/pass_at_k.py` va `metrics/codebleu.py` da co utility khung.
- `pipeline/benchmark_runner.py` va `scripts/run_benchmark.py` da co luong benchmark end-to-end o muc scaffold.
- Code nay la khung khoi dau de mo rong tiep, chua phai ban benchmark production-ready day du.
- Temp va report runtime mac dinh duoc viet vao `data-source/evaluation/` de khong lam dev server reload lien tuc.

## Cach chay khung benchmark hien tai

```bash
cd examio-be/apps/ai-service
PYTHONPATH=. ./venv/bin/python -m src.evaluation.scripts.run_benchmark \
  --dataset humaneval \
  --model-type qwen3_8b \
  --limit 10 \
  --report-name report.json
```

### Chay voi dataset path tuy chinh

```bash
cd examio-be/apps/ai-service
PYTHONPATH=. ./venv/bin/python -m src.evaluation.scripts.run_benchmark \
  --dataset mbpp \
  --dataset-path src/evaluation/datasets/samples/mbpp.json \
  --model-type qwen3_8b \
  --limit 20 \
  --fast-mode true \
  --report-dir src/evaluation/reports \
  --report-name mbpp_report.json
```

## Pham vi da ho tro trong ban scaffold nay

- Trich code tu response AI bang fenced code block extractor.
- Trich code tu response AI bang fenced code block + heuristic khi response kem giai thich dai.
- Chay benchmark Python voi HumanEval/MBPP.
- Chay sandbox C/Python bang `subprocess` va `gcc`.
- Ghi report JSON gom pass rate, pass@1, CodeBLEU va execution timing.

## Viec can lam tiep de san sang production

- Them parser/extractor manh hon cho response khong co code fence.
- Them gioi han memory/process isolation chat hon cho sandbox Docker.
- Xac nhan API package `codebleu` tren moi truong that va bo sung fallback tree-sitter cho C.
- Them bo sample/dataset C thuc su de benchmark AI Tutor cho ngon ngu C.

## Kiem thu nhanh module evaluation

```bash
cd examio-be/apps/ai-service
PYTHONPATH=. ./venv/bin/pytest src/evaluation/tests
```

## Seed benchmark index cho deterministic evaluation

```bash
cd examio-be/apps/ai-service
PYTHONPATH=. ./venv/bin/python -m src.evaluation.scripts.seed_benchmark_index \
  --dataset humaneval \
  --dataset-path src/evaluation/datasets/samples/humaneval_smoke.jsonl
```

```bash
cd examio-be/apps/ai-service
PYTHONPATH=. ./venv/bin/python -m src.evaluation.scripts.seed_benchmark_index \
  --dataset mbpp \
  --dataset-path src/evaluation/datasets/samples/mbpp_smoke.json
```

## Vi du benchmark nho voi dataset fixture tuy chinh

Ban co the dat file HumanEval/MBPP vao `src/evaluation/datasets/samples/` roi chay:

```bash
cd examio-be/apps/ai-service
PYTHONPATH=. ./venv/bin/python -m src.evaluation.scripts.run_benchmark \
  --dataset humaneval \
  --dataset-path src/evaluation/datasets/samples/humaneval_smoke.jsonl \
  --model-type qwen3_8b \
  --limit 5 \
  --fast-mode true \
  --report-name humaneval_smoke_report.json
```

Repo da co san 2 fixture dataset nho de smoke benchmark:

- `src/evaluation/datasets/samples/humaneval_smoke.jsonl`
- `src/evaluation/datasets/samples/mbpp_smoke.json`
