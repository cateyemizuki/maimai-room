"""Validate against original host modules without starting MaiBot or any model.

Usage: python tests/validate_host.py --host-src <MaiBot-source> --sdk-path <optional-sdk-directory>
This is a development harness, never imported by plugin.py.
"""
from __future__ import annotations

from pathlib import Path

import argparse
import ast
import asyncio
import importlib.util
import inspect
import json
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host-src", required=True)
    parser.add_argument("--sdk-path", default="")
    parser.add_argument("--report", default="")
    args = parser.parse_args()
    host = Path(args.host_src).resolve()
    if args.sdk_path:
        sys.path.insert(0, str(Path(args.sdk_path).resolve()))
    sys.path.insert(0, str(host))
    # Intentionally import the original complete host validator and schema.
    from src.plugin_runtime.runner.manifest_validator import PluginManifest
    from src.plugin_runtime.runner.plugin_loader import PluginLoader
    from src.plugin_runtime.webui_schema import load_webui_extension, validate_json
    import maibot_sdk

    root = Path(__file__).resolve().parents[1]
    manifest = PluginManifest.model_validate_json((root / "_manifest.json").read_text(encoding="utf-8"))
    spec = importlib.util.spec_from_file_location("room_original_host_validation", root / "plugin.py", submodule_search_locations=[str(root)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    plugin = module.create_plugin()
    PluginLoader._validate_sdk_plugin_contract(manifest.id, plugin)
    plugin.set_plugin_config({})
    extension = load_webui_extension(str(root))
    components = plugin.get_components()
    apis = {entry["name"]: entry for entry in components if entry["type"] == "API"}
    validate_json(components, max_bytes=524288, max_depth=32)
    validate_json(plugin.get_webui_config_schema(), max_bytes=524288, max_depth=32)
    samples = {"chat_history": {}, "ui_event": {"name":"test.button","detail":"{}","request_id":"host-click-0001"}, "summary": {}, "client_config": {}, "media_chunk": {"media_id": "validation-media-id", "index": 0},
               "runtime_chunk": {"encoding": "gzip", "index": 0}, "model_info": {"quality": "high"}, "model_chunk": {"index": 0, "quality": "mobile"},
               "chat_status": {"request_id": "host-validation-0001"},
               "interact": {"command": "dance", "request_id": "host-validation-0002"},
               "garden": {"action": "plant", "plot": 0, "crop": "carrot", "quantity": 1, "request_id": "host-validation-0003"},
               "chat_send": {"text": "离线参数校验，不会发送", "request_id": "host-validation-0004"}}
    samples.update(tv_status={"request_id": "host-validation-tv-0001"},
                   tv_review={"image_data": "data:image/png;base64,AA==", "request_id": "host-validation-tv-0002"},
                   tv_save_frame={"image_data": "data:image/png;base64,AA==", "request_id": "host-validation-tv-0003"})
    validated = []
    page = extension.pages[0]
    for kind in ("queries", "actions"):
        for alias, binding in getattr(page, kind).items():
            sample = samples[alias]
            binding.validate_args(sample)
            entry = apis[binding.api]
            assert entry["metadata"]["version"] == binding.version
            handler = getattr(plugin, entry["metadata"]["handler_name"])
            inspect.signature(handler).bind(**sample)
            validated.append(kind + ":" + alias)
    rejected = []
    for alias, bad_args in [("runtime_chunk", {"encoding": "private", "index": 0}), ("model_info", {"quality": "../private"}), ("model_chunk", {"index": True}),
                            ("garden", {"action": "plant", "plot": 8}), ("chat_send", {"text": "x" * 2001, "request_id": "id"}),
                            ("tv_review", {"image_data": "x" * 48001, "request_id": "host-validation-tv-0004"})]:
        binding = (page.queries | page.actions)[alias]
        try:
            binding.validate_args(bad_args)
        except ValueError:
            rejected.append(alias)
        else:
            raise AssertionError("Host schema accepted invalid arguments: " + alias)
    # Check names in the original registry without invoking capabilities.
    tree = ast.parse((host / "src/plugin_runtime/capabilities/registry.py").read_text(encoding="utf-8"))
    registered = {node.args[0].value for node in ast.walk(tree) if isinstance(node, ast.Call) and node.args
                  and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)
                  and ((isinstance(node.func, ast.Name) and node.func.id == "_register")
                       or (isinstance(node.func, ast.Attribute) and node.func.attr == "register_capability"))}
    assert set(manifest.capabilities) <= registered, "Unknown host capability"
    module.ensure_garden(plugin._state)
    validate_json(plugin._view(), max_bytes=524288)

    async def model_checks():
        values = []
        for quality in ("mobile", "high"):
            info = await plugin.room_model_info(quality=quality)
            chunk = await plugin.room_model_chunk(index=0, quality=quality)
            validate_json(info, max_bytes=524288)
            validate_json(chunk, max_bytes=524288)
            values.append({"quality": quality, "bytes": info["size"], "chunks": info["chunks"], "sha256": info["sha256"],
                           "firstChunkJsonBytes": len(json.dumps(chunk, separators=(",", ":")).encode())})
        return values

    report = {"manifest": "original-complete-validator-pass", "sdk": maibot_sdk.__version__,
              "pluginContract": "original-host-loader-pass", "pluginId": manifest.id,
              "webuiProtocol": extension.schema_version, "documentBytes": len(page.document.encode()),
              "bindings": validated, "invalidArgumentsRejected": rejected,
              "capabilitiesFoundInHostRegistry": manifest.capabilities, "models": asyncio.run(model_checks()),
              "externalMessagesSent": 0, "modelGenerationsRequested": 0}
    if args.report:
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
