#!/usr/bin/env python3
import json
import os
import sys
import time
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: generate-demo-data.py <target_demo_dir>")
        sys.exit(1)

    demo_root = Path(sys.argv[1]).resolve()
    archive_dir = demo_root / ".local" / "share" / "chatvault" / "archive"
    import_dir = demo_root / "Documents" / "ChatVault Import"
    backup_dir = demo_root / "Documents" / "ChatVault Backup"

    now_ms = int(time.time() * 1000)
    day_ms = 86400 * 1000
    hour_ms = 3600 * 1000

    def make_snapshot(provider, chat_id, title, project, preview, msgs, age_days=0, age_hours=0):
        t_ms = now_ms - (age_days * day_ms) - (age_hours * hour_ms)
        iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t_ms / 1000))
        formatted_msgs = []
        for role, text in msgs:
            formatted_msgs.append({
                "role": role,
                "ts": iso,
                "text": text,
                "kind": "text"
            })
        
        target_dir = archive_dir / provider
        target_dir.mkdir(parents=True, exist_ok=True)
        file_path = target_dir / f"{chat_id}.json"

        snapshot = {
            "schemaVersion": 1,
            "archivedAtMs": t_ms,
            "chat": {
                "provider": provider,
                "id": chat_id,
                "localId": chat_id,
                "title": title,
                "account": "Workspace",
                "project": project,
                "cwd": f"/home/demo/projects/{project}",
                "createdMs": t_ms - (2 * hour_ms),
                "lastMs": t_ms,
                "archived": False,
                "size": len(json.dumps(formatted_msgs)),
                "path": f"archive:{file_path}",
                "model": "claude-3-7-sonnet" if provider == "claude" else ("gpt-4o" if provider == "codex" else "gemini-2.5-pro"),
                "hasMetadata": True,
                "backup": False,
                "userArchived": False,
                "preview": preview
            },
            "messages": formatted_msgs
        }

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2)

    # 1. Claude Code
    make_snapshot(
        "claude", "claude-01",
        "Building an Async Worker Pool in Rust", "rust-cli",
        "How do we structure a bounded async worker pool using tokio::sync::mpsc?",
        [
            ("user", "How do we structure a bounded async worker pool using tokio::sync::mpsc in Rust?"),
            ("assistant", "To build a robust async worker pool in Tokio with bounded backpressure, use a worker task loop receiving from an `mpsc::Receiver`:\n\n```rust\nuse tokio::sync::mpsc;\n\npub struct WorkerPool<T> {\n    tx: mpsc::Sender<T>,\n}\n\nimpl<T: Send + 'static> WorkerPool<T> {\n    pub fn new(workers: usize, buffer: usize, handler: fn(T)) -> Self {\n        let (tx, mut rx) = mpsc::channel::<T>(buffer);\n        let rx = std::sync::Arc::new(tokio::sync::Mutex::new(rx));\n        for _ in 0..workers {\n            let rx = rx.clone();\n            tokio::spawn(async move {\n                while let Some(job) = rx.lock().await.recv().await {\n                    handler(job);\n                }\n            });\n        }\n        Self { tx }\n    }\n}\n```\n\nThis guarantees bounded memory usage while saturating available CPU cores."),
            ("user", "Can we add graceful shutdown support using CancellationToken?"),
            ("assistant", "Yes, `tokio_util::sync::CancellationToken` integrates cleanly:\n\n```rust\nuse tokio_util::sync::CancellationToken;\n\npub async fn run_worker(mut rx: mpsc::Receiver<Task>, token: CancellationToken) {\n    loop {\n        tokio::select! {\n            _ = token.cancelled() => {\n                println!(\"Shutting down worker gracefully...\");\n                break;\n            }\n            Some(job) = rx.recv() => {\n                job.execute().await;\n            }\n        }\n    }\n}\n```")
        ],
        age_days=0, age_hours=1
    )

    make_snapshot(
        "claude", "claude-02",
        "Refactoring REST API Endpoints with Actix-web", "api-service",
        "Let's review the authentication middleware and session validation in Actix.",
        [
            ("user", "Let's review the authentication middleware and session validation in Actix."),
            ("assistant", "Here is a clean extraction of auth extraction into an `FromRequest` extractor:\n\n```rust\nimpl FromRequest for AuthenticatedUser {\n    type Error = actix_web::Error;\n    type Future = Pin<Box<dyn Future<Output = Result<Self, Self::Error>>>>;\n\n    fn from_request(req: &HttpRequest, _payload: &mut Payload) -> Self::Future {\n        // Validate bearer token or cookie session\n        Box::pin(async move { Ok(AuthenticatedUser { id: 42 }) })\n    }\n}\n```")
        ],
        age_days=1, age_hours=4
    )

    # 2. Codex
    make_snapshot(
        "codex", "codex-01",
        "Optimizing Vite and Tailwind CSS Bundles", "web-platform",
        "What are the best strategies to decrease initial bundle size under Vite 8?",
        [
            ("user", "What are the best strategies to decrease initial bundle size under Vite 8?"),
            ("assistant", "Key optimizations for Vite bundle efficiency:\n\n1. **Manual Chunking**: Split vendor libraries like Lucide and Recharts into dedicated chunks:\n\n```ts\n// vite.config.ts\nbuild: {\n  rollupOptions: {\n    output: {\n      manualChunks: {\n        vendor: ['react', 'react-dom'],\n        charts: ['recharts'],\n      }\n    }\n  }\n}\n```\n2. **Dynamic Imports**: Lazy-load heavy dialogs (`OverviewPage`, `SyncDialog`).\n3. **Modern Target**: Set `target: 'esnext'` to eliminate legacy polyfills.")
        ],
        age_days=0, age_hours=3
    )

    make_snapshot(
        "codex", "codex-02",
        "Implementing SQLite Full-Text Search Tokenizer", "chat-vault",
        "How can we benchmark FTS5 queries with custom porter stemming in Rust?",
        [
            ("user", "How can we benchmark FTS5 queries with custom porter stemming in Rust?"),
            ("assistant", "We can run `EXPLAIN QUERY PLAN` directly using `rusqlite` to verify that `chats_fts` hits the FTS index instead of sequential scans:\n\n```sql\nEXPLAIN QUERY PLAN \nSELECT rowid, rank FROM chats_fts WHERE chats_fts MATCH 'sqlite OR tokio' ORDER BY rank LIMIT 50;\n```\n\nUnder FTS5, BM25 scoring is computed natively without temporary B-trees.")
        ],
        age_days=2, age_hours=2
    )

    # 3. Hermes
    make_snapshot(
        "hermes", "hermes-01",
        "Kubernetes Cluster Health Diagnostic & Autoscaling", "infra-k8s",
        "Hermes, run a diagnostic on failing node pool ingress controllers.",
        [
            ("user", "Hermes, run a diagnostic on failing node pool ingress controllers."),
            ("assistant", "Inspecting ingress controller deployment across namespaces:\n\n```bash\nkubectl get pods -n ingress-nginx -o wide\nkubectl top nodes\n```\n\n**Findings:**\n- `ingress-nginx-controller-7f49c`: 100% CPU throttling due to burst traffic.\n- Recommended mitigation: Increase HPA target to 70% CPU and bump replica limits from 3 to 8.")
        ],
        age_days=1, age_hours=8
    )

    # 4. Antigravity
    make_snapshot(
        "antigravity", "ag-01",
        "Designing Multi-Agent Coordination Protocol", "ai-orchestrator",
        "Let's formalize the reactive wakeup message schema for subagents.",
        [
            ("user", "Let's formalize the reactive wakeup message schema for subagents."),
            ("assistant", "The coordination protocol uses asynchronous mailbox notifications without polling loops:\n\n```json\n{\n  \"type\": \"AGENT_NOTIFICATION\",\n  \"source\": \"subagent-1\",\n  \"event\": \"TASK_COMPLETED\",\n  \"timestamp\": \"2026-11-19T05:20:00Z\",\n  \"payload\": {\n    \"exitCode\": 0,\n    \"artifacts\": [\"build/output.tar.gz\"]\n  }\n}\n```\n\nThis guarantees zero-token idle wait states while maintaining immediate responsiveness.")
        ],
        age_days=0, age_hours=5
    )

    # 5. OpenCode
    make_snapshot(
        "opencode", "opencode-01",
        "Zero-Copy Memory Buffer Protocol in C++20", "kernel-modules",
        "How do we structure std::span with DMA memory mapped regions?",
        [
            ("user", "How do we structure std::span with DMA memory mapped regions?"),
            ("assistant", "In C++20, `std::span` provides bounds-checked view over non-owning raw memory buffers:\n\n```cpp\n#include <span>\n#include <sys/mman.h>\n\nstruct DmaBuffer {\n    void* raw_ptr;\n    size_t length;\n\n    std::span<const uint8_t> as_span() const {\n        return { static_cast<const uint8_t*>(raw_ptr), length };\n    }\n};\n```")
        ],
        age_days=3, age_hours=1
    )

    # 6. Grok
    make_snapshot(
        "grok", "grok-01",
        "Comparative Analysis: SQLite vs DuckDB for Analytics", "data-warehouse",
        "Compare vectorized OLAP performance between SQLite and DuckDB on 10M rows.",
        [
            ("user", "Compare vectorized OLAP performance between SQLite and DuckDB on 10M rows."),
            ("assistant", "| Feature | SQLite | DuckDB |\n| :--- | :--- | :--- |\n| Storage Model | Row-oriented (B-Tree) | Column-oriented (Parquet-native) |\n| Query Engine | Scalar iterator | Vectorized execution engine |\n| 10M Aggregation | ~1.4s | ~42ms |\n| Memory Footprint | Minimal (<4MB) | Adaptive buffer pool |")
        ],
        age_days=4, age_hours=6
    )

    # 7. Imported (NousSave drop folder)
    noussave_chat = {
        "schema_version": 2,
        "exported_at": "2026-11-19T05:00:00Z",
        "vine": {
            "id": "nous-import-01",
            "title": "Architecture Blueprint: Local-First Desktop Storage",
            "created_at": "2026-11-18T12:00:00Z",
            "messages": [
                {
                    "author": "user",
                    "timestamp": "2026-11-18T12:00:00Z",
                    "content": "What are the core pillars of local-first privacy architecture in ChatVault?"
                },
                {
                    "author": "assistant",
                    "timestamp": "2026-11-18T12:00:20Z",
                    "content": "ChatVault operates on three core principles:\n1. **Read-Only Ingestion**: Canonical SQLite and JSON files are never modified.\n2. **Private Local Snapshots**: Normalized JSON archives live strictly on local disks.\n3. **Decoupled Backups**: User controls backup locations and selective restore without vendor lock-in."
                }
            ]
        }
    }
    with open(import_dir / "Architecture-Blueprint.json", "w", encoding="utf-8") as f:
        json.dump(noussave_chat, f, indent=2)

    # Generate realistic Backup dummy files for Sync & Backup screen
    sources = ["claude", "codex", "archive", "imported"]
    for src in sources:
        src_backup_dir = backup_dir / src
        src_backup_dir.mkdir(parents=True, exist_ok=True)
        for i in range(1, 11):
            dummy_file = src_backup_dir / f"backup-sample-{i:02d}.json"
            dummy_file.write_text(f'{{"backup": true, "source": "{src}", "sample": {i}, "timestamp": {now_ms}}}\n')

    print(f"Successfully generated synthetic demo data in {demo_root}")

if __name__ == "__main__":
    main()

