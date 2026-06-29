# Entity Resolution API

A Flask API that performs fuzzy name deduplication using [Splink](https://github.com/moj-analytical-services/splink).

## Setup

```bash
pip install -r requirements.txt
```

## Usage

Start the server:

```bash
python entity-resolution.py
```

The server runs on `http://0.0.0.0:5000`.

### Endpoint: `POST /payees`

**Request body:**

```json
{
  "data": [
    { "id": 1, "name": "John Smith" },
    { "id": 2, "name": "Jon Smith" }
  ]
}
```

**Response:**

```json
{
  "ok": true,
  "received": 2,
  "clusters": [
    { "cluster_id": 1, "unique_id": 1, "name": "John Smith" },
    { "cluster_id": 1, "unique_id": 2, "name": "Jon Smith" }
  ]
}
```

Records with similar names are assigned the same `cluster_id`.
