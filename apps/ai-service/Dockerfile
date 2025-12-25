FROM python:3.13-slim

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and data
COPY src /app/src
COPY document_graph /app/document_graph
COPY department_graphs /app/department_graphs

CMD ["sleep", "infinity"]
