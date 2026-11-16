import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class ResponseHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        if self.path == "/native-websocket":
            return self.open_websocket()

        body = b'{"desktop":"native relay"}'
        self.send_response(422)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


    def do_POST(self):
        if self.path == "/native-mock-callback":
            context = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            body = json.dumps({"statusCode": 202, "body": {"callback": True, "id": context["params"]["id"]}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path != "/native-graphql":
            self.send_error(404)
            return
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if request.get("operationName") != "Request" or "method" not in request.get("query", ""):
            self.send_error(400)
            return
        body = b'{"data":{"method":"native-workbench-graphql","url":"/native-graphql","headers":[]}}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def open_websocket(self):
        key = self.headers["Sec-WebSocket-Key"]
        accept = base64.b64encode(
            hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
        ).decode()
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        message = b"native-workbench-websocket"
        self.wfile.write(bytes([0x81, len(message)]) + message)
        self.wfile.write(b"\x88\x02\x03\xe8")
        self.close_connection = True


def exercise_mcp(root, target, stopped):
    def wait(check):
        end = time.monotonic() + 35
        while not stopped.is_set() and time.monotonic() < end:
            result = check()
            if result:
                return result
            stopped.wait(0.2)
        raise RuntimeError("MCP smoke timed out")

    path = root / "logs" / "mcp-test.log"

    def read_config():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return None

    access = wait(read_config)
    url = access["url"]
    headers = {
        **access["headers"],
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
    }

    def rpc(method, params=None, request_headers=None):
        payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})
        request = Request(url, data=payload.encode(), headers=request_headers or headers)
        with urlopen(request, timeout=5) as response:
            return json.load(response)

    def tool(name, args):
        response = rpc("tools/call", {"name": name, "arguments": args})["result"]
        if response["isError"]:
            raise RuntimeError(response["content"][0]["text"])
        return json.loads(response["content"][0]["text"])

    for wrong_headers, status in (({"Content-Type": "application/json"}, 401), ({**headers, "Origin": "https://foreign.invalid"}, 403)):
        try:
            rpc("initialize", request_headers=wrong_headers)
        except HTTPError as error:
            assert error.code == status
        else:
            raise AssertionError("MCP accepted an unauthorized connection")
    assert rpc("initialize")["result"]["protocolVersion"] == "2025-11-25"
    assert len(rpc("tools/list")["result"]["tools"]) == 5
    assert rpc("tools/call", {"name": "approve", "arguments": {}})["error"]["code"] == -32602
    collections = tool("workbench_list", {"entity": "collection"})["items"]
    collection_id = collections[0]["id"]
    assert tool("workbench_list", {"entity": "request"})["items"] == []
    changes = [
        ("request", {"name": "MCP request", "collectionID": collection_id, "protocol": "rest", "method": "GET", "endpoint": target,
                     "headers": [{"key": "Authorization", "value": "Bearer test-secret"}]}),
        ("environment", {"name": "MCP environment", "variables": [{"key": "apiKey", "initialValue": "environment-test-secret", "secret": True}]}),
        ("documentation", {"title": "MCP documentation", "collectionID": collection_id}),
    ]
    proposals = []
    for entity, data in changes:
        arguments = {"entity": entity, "operation": "create", "data": data, "reason": "Native smoke", "idempotencyKey": f"native-smoke-{entity}"}
        proposal = tool("workbench_propose_change", arguments)
        assert proposal["status"] == "pending"
        assert tool("workbench_propose_change", arguments)["id"] == proposal["id"]
        proposals.append(proposal["id"])
    resolved = wait(lambda: statuses(tool, proposals))
    result_id = resolved[0]["result"]["id"]
    created = tool("workbench_get", {"entity": "request", "id": result_id})
    assert "test-secret" not in json.dumps(created)
    docs = url.removesuffix("/mcp") + "/docs/" + resolved[2]["result"]["id"]
    with urlopen(docs, timeout=5) as response:
        assert "MCP documentation" in response.read().decode()
    environment_id = resolved[1]["result"]["id"]
    environment = tool("workbench_get", {"entity": "environment", "id": environment_id})
    assert environment["data"]["variables"][0]["secret"] is True
    assert "environment-test-secret" not in json.dumps(environment)
    follow_up = [
        ("collection", "create", None, {"name": "MCP folder", "parentID": collection_id}),
        ("automation", "create", None, {"name": "MCP automation", "collectionID": collection_id, "config": {"iterations": 2}}),
        ("load_test", "create", None, {"name": "MCP load", "requestID": result_id, "config": {"mode": "requests", "requests": 20}}),
        ("websocket", "create", None, {"name": "MCP socket", "url": "ws://127.0.0.1:3188"}),
        ("environment", "update", environment_id, {"name": "MCP environment updated"}),
    ]
    next_ids = []
    for entity, operation, id, data in follow_up:
        arguments = {"entity": entity, "operation": operation, "data": data, "reason": "Native smoke",
                     "idempotencyKey": f"native-smoke-more-{entity}"}
        if id:
            arguments["id"] = id
        next_ids.append(tool("workbench_propose_change", arguments)["id"])
    more = wait(lambda: statuses(tool, next_ids))
    for proposal, (entity, _, _, data) in zip(more, follow_up):
        saved = tool("workbench_get", {"entity": entity, "id": proposal["result"]["id"]})
        assert saved["data"]["name"] == data["name"]
    socket_id = more[3]["result"]["id"]
    deletion = tool("workbench_propose_change", {"entity": "websocket", "operation": "delete",
        "id": socket_id, "reason": "Native smoke cleanup", "idempotencyKey": "native-smoke-delete-socket"})
    assert tool("workbench_get", {"entity": "websocket", "id": socket_id})
    wait(lambda: statuses(tool, [deletion["id"]]))
    assert tool("workbench_list", {"entity": "websocket"})["items"] == []
    print("Native MCP: all 7 configuration domains, approvals, redaction and local documentation passed")


def statuses(tool, ids):
    resolved = [tool("workbench_change_status", {"proposalID": id}) for id in ids]
    if any(proposal["status"] not in ("pending", "applied") for proposal in resolved):
        raise RuntimeError(str([(p["status"], p.get("error")) for p in resolved]))
    return resolved if all(proposal["status"] == "applied" for proposal in resolved) else None


def main():
    # Rust 输出 UTF-8；Windows 的默认代码页不能可靠解码中文验收日志。
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    executable = Path(sys.argv[1]).resolve(strict=True)
    capture_only = "--capture-only" in sys.argv[2:]
    mock_only = "--mock-only" in sys.argv[2:]
    # 隔离测试存储和监听端口，重启时复用同一份测试数据。
    with tempfile.TemporaryDirectory(prefix="apirequest-native-") as directory:
        stopped = threading.Event()
        with ThreadPoolExecutor(max_workers=1) as clients, http.server.ThreadingHTTPServer(("127.0.0.1", 0), ResponseHandler) as server:
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                env = {
                    **os.environ,
                    "APIREQUEST_NATIVE_SMOKE_DIR": directory,
                    "APIREQUEST_NATIVE_SMOKE_TARGET": f"http://127.0.0.1:{server.server_port}/native-smoke",
                }
                if capture_only:
                    env["APIREQUEST_NATIVE_CAPTURE_SMOKE"] = "1"
                if mock_only:
                    env["APIREQUEST_NATIVE_MOCK_SMOKE"] = "1"
                client = None if capture_only or mock_only else clients.submit(exercise_mcp, Path(directory), env["APIREQUEST_NATIVE_SMOKE_TARGET"], stopped)
                for restart in (False, True):
                    if restart:
                        env["APIREQUEST_NATIVE_SMOKE_RESTART"] = "1"
                    result = subprocess.run(
                        [executable],
                        env=env,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=70,
                    )
                    print(result.stdout, end="")
                    if result.returncode != 0 or "Native smoke: passed" not in result.stdout:
                        if client and client.done():
                            client.result()
                        raise RuntimeError(f"Native smoke did not finish successfully (exit {result.returncode})")
                    if not restart and client:
                        client.result(timeout=10)
            finally:
                stopped.set()
                server.shutdown()
                thread.join()


if __name__ == "__main__":
    main()
