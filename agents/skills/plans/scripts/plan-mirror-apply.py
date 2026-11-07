# Applies a plan-mirror.mjs operation file to Notion through the Notion MCP tools.
# Runs inside an omp eval (Python) kernel, which exposes `tool.write` for xd://
# devices:
#
#   %load ~/.agents/skills/plans/scripts/plan-mirror-apply.py
#   summary = await apply_mirror("/tmp/mirror-plan.json", "/tmp/mirror-results.json")
#
# Then record what was applied:
#   node ~/.agents/skills/plans/scripts/plan-mirror.mjs record --plan /tmp/mirror-plan.json --results /tmp/mirror-results.json
#
# Trash operations (a plan or supporting doc that no longer exists locally) are
# only reported unless confirm_trash=True. Notion requires the user to confirm
# deletions, so show `summary["trash_pending"]` and re-run after they agree.

import json
import re

_UUID = re.compile(r"[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}")


async def _notion(name, args):
    result = await tool.write({"path": f"xd://notion-{name}", "content": json.dumps(args), "i": f"Mirroring plans: {name}"})
    text = result.get("text", "") if isinstance(result, dict) else str(result)
    if (isinstance(result, dict) and result.get("hasError")) or text.startswith("Error"):
        raise RuntimeError(f"notion-{name}: {text[:500]}")
    return text


def _page_ids(text):
    """Page ids of created pages, in creation order."""
    try:
        return [p["id"].replace("-", "") for p in json.loads(text)["pages"]]
    except (ValueError, KeyError, TypeError):
        pass
    seen = []  # older responses were prose; the data source id is excluded by the caller
    for match in _UUID.findall(text):
        clean = match.replace("-", "")
        if clean not in seen:
            seen.append(clean)
    return seen


def _page_tag(page_id, title):
    safe = title.replace("<", "\\<")
    return f'<page url="https://www.notion.so/{page_id}">{safe}</page>'


async def _create_pages(parent, pages, exclude):
    text = await _notion("create-pages", {"parent": parent, "pages": pages, "allow_async": False})
    ids = [i for i in _page_ids(text) if i not in exclude]
    if len(ids) < len(pages):
        raise RuntimeError(f"expected {len(pages)} page ids, found {len(ids)}: {text[:300]}")
    return ids[: len(pages)]


async def _create_children(row_id, children, exclude):
    created = {}
    for child in children:
        [child_id] = await _create_pages({"page_id": row_id}, [{"properties": {"title": child["title"]}, "content": child["content"]}], exclude | {row_id})
        created[child["file"]] = {"pageId": child_id}
    return created


async def apply_mirror(plan_path, results_path, confirm_trash=False):
    with open(plan_path) as f:
        plan = json.load(f)
    data_source = plan["dataSource"].removeprefix("collection://")
    exclude = {data_source.replace("-", "")}
    results, trash_pending, errors = [], [], []

    for op in plan["ops"]:
        key = op["key"]
        try:
            if op["op"] == "trash":
                if not confirm_trash:
                    trash_pending.append(key)
                    continue
                await _notion("delete-pages", {"page_ids": [op["pageId"]], "user_confirmed": True})
                results.append({"key": key})
                continue

            if op["op"] == "create":
                [row_id] = await _create_pages({"data_source_id": data_source}, [{"properties": op["properties"], "content": op["content"]}], exclude)
                children = await _create_children(row_id, op["children"], exclude)
                results.append({"key": key, "pageId": row_id, "children": children})
                continue

            # update
            row_id = op["pageId"]
            children = {}
            to_create = [c for c in op["children"] if c["op"] == "create"]
            children.update(await _create_children(row_id, to_create, exclude))
            for child in op["children"]:
                if child["op"] == "update":
                    body = child["content"]
                    await _notion("update-page", {"page_id": child["pageId"], "command": "replace_content", "new_str": body, "allow_async": False})
                    children[child["file"]] = {"pageId": child["pageId"]}
                elif child["op"] == "trash":
                    if not confirm_trash:
                        trash_pending.append(f"{key}/{child['file']}")
                        continue
                    await _notion("delete-pages", {"page_ids": [child["pageId"]], "user_confirmed": True})
                    children[child["file"]] = {}
            if op.get("properties") is not None:
                await _notion("update-page", {"page_id": row_id, "command": "update_properties", "properties": op["properties"], "allow_async": False})
            if op.get("content") is not None:
                # replace_content deletes subpages it does not reference, so list every surviving child.
                keep = [(f, v["pageId"]) for f, v in children.items() if v.get("pageId")]
                keep += [(c["file"], c["pageId"]) for c in op["children"] if c["op"] == "trash" and not confirm_trash]
                keep += [(f, pid) for f, pid in op.get("unchangedChildren", {}).items()]
                tags = "\n".join(_page_tag(pid, f) for f, pid in sorted(set(keep)))
                await _notion("update-page", {"page_id": row_id, "command": "replace_content", "new_str": op["content"] + ("\n\n" + tags if tags else ""), "allow_async": False})
            results.append({"key": key, "pageId": row_id, "children": children})
        except Exception as error:  # keep going; failed ops stay pending and are retried next run
            errors.append({"key": key, "error": str(error)[:500]})

    with open(results_path, "w") as f:
        json.dump(results, f)
    return {"applied": len(results), "trash_pending": trash_pending, "errors": errors}
