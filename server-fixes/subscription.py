# -*- coding: utf-8 -*-
"""Subscription module for WineToken New-API."""
import hmac
import json
import time
from typing import Optional
from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse
from . import config as cfgmod
from .newapi import _query_json

router = APIRouter(prefix="/api/subscription", tags=["subscription"])


def _extract_bearer_token(auth_header: Optional[str]) -> Optional[str]:
    if not auth_header:
        return None
    header = auth_header.strip()
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return header


def _get_admin_key() -> str:
    try:
        cfg = cfgmod.get_config()[0]
        return str(cfg.get("api_key") or "")
    except Exception:
        return ""


def get_subscription_status(token: Optional[str] = None, user_id: Optional[int] = None, is_admin: bool = False) -> dict:
    if not token and not is_admin:
        return {"ok": False, "error": "unauthorized", "message": "Missing Bearer token"}
    if not is_admin:
        user_id = None

    clean_key = None
    raw_key = None
    if token:
        tk = token.strip()
        if tk.lower().startswith("bearer "):
            tk = tk[7:].strip()
        raw_key = tk
        if tk.lower().startswith("sk-"):
            clean_key = tk[3:].strip()
        else:
            clean_key = tk

    where_tok_parts = []
    if clean_key:
        esc_clean = clean_key.replace("'", "''")
        esc_raw = (raw_key or clean_key).replace("'", "''")
        where_tok_parts.append(f"(key = '{esc_clean}' OR key = '{esc_raw}')")
    if user_id:
        where_tok_parts.append(f"user_id = {int(user_id)}")
    where_tok = " OR ".join(where_tok_parts) if where_tok_parts else "1=0"

    user_clause = "u.id = (SELECT user_id FROM tok)"
    if user_id:
        user_clause = f"{user_clause} OR u.id = {int(user_id)}"

    sql = f"""
    WITH tok AS (
        SELECT id, user_id, name, "group", remain_quota, unlimited_quota, used_quota
        FROM tokens
        WHERE {where_tok}
        ORDER BY id DESC
        LIMIT 1
    ),
    target_user AS (
        SELECT u.id, u.username, u.display_name, u."group", u.quota, u.used_quota
        FROM users u
        WHERE {user_clause}
        LIMIT 1
    ),
    active_sub AS (
        SELECT
            us.id AS subscription_id,
            us.plan_id,
            sp.title AS plan_title,
            us.status AS subscription_status,
            sp.upgrade_group,
            us.amount_total,
            us.amount_used,
            us.start_time,
            us.end_time
        FROM user_subscriptions us
        JOIN subscription_plans sp ON us.plan_id = sp.id
        WHERE us.user_id = (SELECT id FROM target_user)
          AND us.status = 'active'
          AND us.end_time > EXTRACT(EPOCH FROM NOW())::bigint
        ORDER BY us.id DESC
        LIMIT 1
    )
    SELECT
        t.id AS token_id,
        t.name AS token_name,
        t."group" AS token_group,
        t.remain_quota AS token_remain_quota,
        t.unlimited_quota AS token_unlimited_quota,
        t.used_quota AS token_used_quota,
        u.id AS user_id,
        u.username,
        u.display_name,
        u."group" AS user_group,
        u.quota AS wallet_quota,
        u.used_quota AS wallet_used_quota,
        s.subscription_id,
        s.plan_id,
        s.plan_title,
        s.subscription_status,
        s.upgrade_group,
        s.amount_total,
        s.amount_used,
        s.start_time,
        s.end_time
    FROM target_user u
    LEFT JOIN tok t ON 1=1
    LEFT JOIN active_sub s ON 1=1;
    """

    rows = _query_json(sql)
    r = rows[0] if rows and isinstance(rows, list) and len(rows) > 0 else None

    if not r or not r.get("user_id"):
        return {"ok": False, "error": "not_found", "message": "User or token not found"}

    now_ts = int(time.time())
    end_time = int(r.get("end_time") or 0)
    has_sub = bool(r.get("subscription_id") and end_time > now_ts)
    days_remaining = max(0, (end_time - now_ts) // 86400) if has_sub else 0

    wallet_quota = int(r.get("wallet_quota") or 0)
    wallet_balance_cny = round(wallet_quota / 500000.0, 2)
    wallet_used_cny = round(int(r.get("wallet_used_quota") or 0) / 500000.0, 2)

    token_used_quota = int(r.get("token_used_quota") or 0)
    token_used_cny = round(token_used_quota / 500000.0, 2)
    amount_used_cny = round(int(r.get("amount_used") or 0) / 500000.0, 2) if has_sub else 0.0

    if has_sub:
        total_used_cny = max(token_used_cny, amount_used_cny)
    else:
        total_used_cny = token_used_cny if r.get("token_id") else wallet_used_cny

    sub_info = None
    if has_sub:
        amount_total = int(r.get("amount_total") or 0)
        amount_used = int(r.get("amount_used") or 0)
        remain_amount = max(0, amount_total - amount_used)
        used_percent = min(100, max(0, round((amount_used / amount_total) * 100))) if amount_total > 0 else 0

        sub_info = {
            "id": r.get("subscription_id"),
            "plan_id": r.get("plan_id"),
            "plan_title": r.get("plan_title") or "VIP 订阅",
            "status": r.get("subscription_status"),
            "upgrade_group": r.get("upgrade_group") or "vip",
            "amount_total": amount_total,
            "amount_used": amount_used,
            "remain_amount": remain_amount,
            "amount_total_cny": round(amount_total / 500000.0, 2),
            "amount_used_cny": round(amount_used / 500000.0, 2),
            "remain_amount_cny": round(remain_amount / 500000.0, 2),
            "used_percent": used_percent,
            "start_time": r.get("start_time"),
            "end_time": end_time,
            "remain_days": days_remaining,
        }

    user_group_str = str(r.get("user_group") or "").strip().lower()
    token_group_str = str(r.get("token_group") or "").strip().lower()
    is_super = bool(user_group_str == "super" or token_group_str == "super")

    return {
        "ok": True,
        "subscribed": has_sub and not is_super,
        "is_super": is_super,
        "group": "super" if is_super else (r.get("user_group") or r.get("token_group") or "default"),
        "wallet_balance_cny": wallet_balance_cny,
        "wallet_used_cny": wallet_used_cny,
        "token_used_cny": token_used_cny,
        "total_used_cny": total_used_cny,
        "user": {
            "id": r.get("user_id"),
            "username": r.get("username"),
            "display_name": r.get("display_name"),
            "group": r.get("user_group"),
            "quota": wallet_quota,
            "used_quota": r.get("wallet_used_quota"),
        },
        "subscription": sub_info,
        "token": {
            "name": r.get("token_name"),
            "group": r.get("token_group"),
            "remain_quota": r.get("token_remain_quota"),
            "used_quota": token_used_quota,
            "used_cny": token_used_cny,
            "unlimited_quota": r.get("token_unlimited_quota"),
        } if r.get("token_id") else None,
    }


@router.get("/status")
async def subscription_status_endpoint(
    request: Request,
    authorization: Optional[str] = Header(None),
    key: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
) -> JSONResponse:
    token_candidate = _extract_bearer_token(authorization) or key
    admin_key = _get_admin_key()
    is_admin = bool(admin_key and token_candidate and hmac.compare_digest(token_candidate, admin_key))

    if not is_admin and not token_candidate:
        return JSONResponse(
            content={"ok": False, "error": "unauthorized", "message": "Missing Bearer token"},
            status_code=401,
        )

    actual_token = None if is_admin else token_candidate

    res = get_subscription_status(
        token=actual_token,
        user_id=user_id if is_admin else None,
        is_admin=is_admin,
    )
    status_code = 200 if res.get("ok") else 401
    return JSONResponse(content=res, status_code=status_code)


# ---------------------------------------------------------------------------
# Models Manifest 模块: 动态模型元数据、画廊规格与权限控制
# ---------------------------------------------------------------------------

BASE_CHAT_METADATA = {
    "deepseek-v4.1-flash": {
        "name": "DeepSeek V4.1 Flash",
        "provider": "deepseek",
        "contextWindow": 1048576,
        "maxTokens": 393216,
        "vision": True,
        "reasoning": True,
    },
    "deepseek-v4.1-flash-free": {
        "name": "DeepSeek V4.1 Flash Free",
        "provider": "deepseek",
        "contextWindow": 1048576,
        "maxTokens": 393216,
        "vision": True,
        "reasoning": True,
    },
    "deepseek-v4-flash": {
        "name": "DeepSeek V4 Flash",
        "provider": "deepseek",
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "vision": False,
        "reasoning": True,
    },
    "deepseek-v4-pro": {
        "name": "DeepSeek V4 Pro",
        "provider": "deepseek",
        "contextWindow": 1048576,
        "maxTokens": 393216,
        "vision": False,
        "reasoning": True,
    },
    "glm-5.4": {
        "name": "GLM-5.4",
        "provider": "zhipu",
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "vision": False,
        "reasoning": True,
    },
    "glm-5.2": {
        "name": "GLM-5.2",
        "provider": "zhipu",
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "vision": False,
        "reasoning": True,
    },
    "glm-5.3-flash": {
        "name": "GLM-5.3 Flash",
        "provider": "zhipu",
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "vision": True,
        "reasoning": True,
    },
    "kimi-k3.1-pro": {
        "name": "Kimi K3.1 Pro",
        "provider": "kimi",
        "contextWindow": 1048576,
        "maxTokens": 32768,
        "vision": True,
        "reasoning": True,
    },
    "mimo-v2.6-pro": {
        "name": "MiMo V2.6 Pro",
        "provider": "mimo",
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "vision": True,
        "reasoning": True,
    },
    "mimo-v2.6-flash": {
        "name": "MiMo V2.6 Flash",
        "provider": "mimo",
        "contextWindow": 200000,
        "maxTokens": 32000,
        "vision": False,
        "reasoning": True,
    },
    "MiniMax-H3": {
        "name": "MiniMax H3",
        "provider": "minimax",
        "contextWindow": 131072,
        "maxTokens": 16384,
        "vision": False,
        "reasoning": True,
    },
    "MiniMax-H3-2K": {
        "name": "MiniMax H3 2K",
        "provider": "minimax",
        "contextWindow": 131072,
        "maxTokens": 16384,
        "vision": False,
        "reasoning": True,
    },
    "minimax-m3.1-flash": {
        "name": "MiniMax M3.1 Flash",
        "provider": "minimax",
        "contextWindow": 1048576,
        "maxTokens": 32768,
        "vision": True,
        "reasoning": True,
    },
    "sensenova-6.8-flash": {
        "name": "SenseNova 6.8 Flash",
        "provider": "sensenova",
        "contextWindow": 262144,
        "maxTokens": 65536,
        "vision": True,
        "reasoning": True,
    },
    "sensenova-u1.5-lite": {
        "name": "SenseNova U1.5 Lite",
        "provider": "sensenova",
        "contextWindow": 65536,
        "maxTokens": 8192,
        "vision": False,
        "reasoning": False,
    },
    "claude-opus-5-5": {
        "name": "Claude 5.5 Opus",
        "provider": "anthropic",
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "vision": True,
        "reasoning": True,
    },
    "claude-fable-5-2": {
        "name": "Claude 5.2 Fable",
        "provider": "anthropic",
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "vision": True,
        "reasoning": True,
    },
    "claude-opus-4-6-thinking": {
        "name": "Claude 4.6 Opus Thinking",
        "provider": "anthropic",
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "vision": True,
        "reasoning": True,
    },
    "claude-sonnet-4-6": {
        "name": "Claude 4.6 Sonnet",
        "provider": "anthropic",
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "vision": True,
        "reasoning": True,
    },
    "gpt-6.2-sol": {
        "name": "GPT-6.2 Sol",
        "provider": "openai",
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "vision": True,
        "reasoning": True,
    },
    "gpt-6.2-astra": {
        "name": "GPT-6.2 Astra",
        "provider": "openai",
        "contextWindow": 1048576,
        "maxTokens": 131072,
        "vision": True,
        "reasoning": True,
    },
    "gpt-oss-120b-medium": {
        "name": "GPT OSS 120B Medium",
        "provider": "openai",
        "contextWindow": 131072,
        "maxTokens": 131072,
        "vision": False,
        "reasoning": True,
    },
    "gpt-6-luna": {
        "name": "GPT-6 Luna",
        "provider": "openai",
        "contextWindow": 272000,
        "maxTokens": 131072,
        "vision": True,
        "reasoning": True,
        "reasoningEfforts": {"low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max"},
    },
    "gpt-5.6-terra": {
        "name": "GPT-5.6 Terra",
        "provider": "openai",
        "contextWindow": 272000,
        "maxTokens": 131072,
        "vision": True,
        "reasoning": True,
        "reasoningEfforts": {"low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max", "ultra": "ultra"},
    },
    "gpt-5.6-luna": {
        "name": "GPT-5.6 Luna",
        "provider": "openai",
        "contextWindow": 272000,
        "maxTokens": 131072,
        "vision": True,
        "reasoning": True,
        "reasoningEfforts": {"low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max"},
    },
    "grok-4.7": {
        "name": "Grok 4.7",
        "provider": "xai",
        "contextWindow": 500000,
        "maxTokens": 16384,
        "vision": True,
        "reasoning": True,
    },
    "hy4": {
        "name": "腾讯混元 Hy4",
        "provider": "hunyuan",
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "vision": True,
        "reasoning": True,
    },
    "hy4-flash": {
        "name": "腾讯混元 Hy4 Flash",
        "provider": "hunyuan",
        "contextWindow": 1048576,
        "maxTokens": 65536,
        "vision": True,
        "reasoning": True,
    },
    "王者荣耀灵宝": {
        "name": "王者荣耀灵宝",
        "provider": "custom",
        "contextWindow": 262144,
        "maxTokens": 16384,
        "vision": False,
        "reasoning": True,
    },
}

BASE_IMAGE_MODELS = [
    {
        "id": "gpt-image-2.6-flare",
        "name": "GPT-Image 2.6 Flare",
        "badge": "超快极速",
        "cost": 0.20,
        "vipCost": 0.16,
        "resolutions": ["1024x1024", "1008x1344", "1344x1008", "1024x1792", "1792x1024"],
        "singleNOnly": True,
        "desc": "极速出图引擎，细节与色彩表现较 2.5 系列进一步升级，适合批量生成与快速选代预审",
    },
    {
        "id": "gpt-image-2.6-sunburst",
        "name": "GPT-Image 2.6 Sunburst",
        "badge": "细腻逼真",
        "cost": 0.30,
        "vipCost": 0.24,
        "resolutions": ["1024x1024", "1008x1344", "1344x1008", "1024x1792", "1792x1024"],
        "singleNOnly": True,
        "desc": "高画质光影渲染，画质与指令遵循能力较 2.5 系列进一步升级，适合海报、插画、设计稿",
    },
    {
        "id": "grok-imagine-image-2.0",
        "name": "Grok Imagine 2.0 旗舰",
        "badge": "创意先锋",
        "cost": 0.50,
        "vipCost": 0.40,
        "resolutions": ["1024x1024", "1008x1344", "1344x1008", "1024x1792", "1792x1024"],
        "singleNOnly": True,
        "desc": "具备顶级发散想象力与自然构图，色彩浓郁张力十足",
    },
    {
        "id": "muse-image",
        "name": "Muse Image",
        "badge": "超值",
        "cost": 0.05,
        "vipCost": 0.04,
        "resolutions": ["1024x1024", "1008x1344", "1344x1008", "1024x1792", "1792x1024"],
        "singleNOnly": True,
        "desc": "提示词理解准确，擅长创意概念视觉、插画与写实画面，出图快，超高性价比",
    },
    {
        "id": "nano-banana-2.1",
        "name": "Nano Banana 2.1",
        "badge": "谷歌出图",
        "cost": 0.03,
        "vipCost": 0.024,
        "resolutions": ["1792x1024", "1024x1792", "1024x1024", "1344x1008", "1008x1344"],
        "singleNOnly": True,
        "desc": "提示词理解与文字渲染出色，细节丰富光影自然，支持文生图与带图编辑，五种画幅三档分辨率",
    },
    {
        "id": "sensenova-u1.5-lite",
        "name": "商汤 SenseNova U1.5 Lite",
        "badge": "限免4K",
        "cost": 0.00,
        "vipCost": 0.00,
        "resolutions": ["1024x1024", "1008x1344", "1344x1008", "1024x1792", "1792x1024"],
        "singleNOnly": True,
        "desc": "4K超清直出，中英文字排版与概念艺术",
    },
]

BASE_VIDEO_MODELS = [
    {
        "id": "MiniMax-H3",
        "name": "MiniMax H3",
        "badge": "电影感",
        "costPerSec": 0.12,
        "vipCostPerSec": 0.096,
        "durations": [5, 6, 10, 15],
        "resolutions": ["1280x720", "720x1280"],
        "desc": "768P 电影级光影，原生支持 5~15 秒长片生成与首帧动态驱动",
    },
    {
        "id": "MiniMax-H3-2K",
        "name": "MiniMax H3 2K",
        "badge": "电影感",
        "costPerSec": 0.20,
        "vipCostPerSec": 0.16,
        "durations": [5, 6, 10, 15],
        "resolutions": ["2560x1440", "1440x2560"],
        "desc": "2K 电影级光影，原生支持 5~15 秒长片生成与首帧动态驱动",
    },
    {
        "id": "grok-imagine-video-1.5",
        "name": "Grok Imagine 视频旗舰",
        "badge": "极致光影",
        "costPerSec": 0.20,
        "vipCostPerSec": 0.16,
        "durations": [5, 10],
        "resolutions": ["1280x720", "720x1280", "1920x1080", "1080x1920"],
        "desc": "顶尖电影级动态生成，真实光影与物理一致性 (480p/720p/1080p 三档，最高 15 秒)",
    },
    {
        "id": "muse-video",
        "name": "Muse Video",
        "badge": "超值",
        "costPerSec": 0.05,
        "vipCostPerSec": 0.04,
        "durations": [5, 6, 10, 15],
        "resolutions": ["1280x720", "720x1280"],
        "desc": "运动连贯自然、镜头语言丰富，720P 出片，时长与横竖画幅可选，支持文生视频与首帧图生视频",
    },
    {
        "id": "omni-1.2-flash",
        "name": "Omni 1.2 Flash",
        "badge": "原生音频",
        "costPerSec": 0.08,
        "vipCostPerSec": 0.064,
        "durations": [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        "resolutions": ["1280x720", "720x1280"],
        "desc": "原生带音频，运动连贯自然、镜头语言丰富，3~15 秒任意时长，横竖双画幅，支持参考图",
    },
]

_MANIFEST_CACHE = {}
_MANIFEST_CACHE_TTL = 30  # 30秒轻量缓存


def _parse_model_tags(tags_str: str) -> dict:
    tags = [t.strip() for t in (tags_str or "").split(",") if t.strip()]
    has_vision = any(t.lower() == "vision" for t in tags)
    has_reasoning = any(t.lower() == "reasoning" for t in tags)

    context_window = 131072
    for t in tags:
        t_upper = t.upper()
        if t_upper.endswith("K") and t_upper[:-1].isdigit():
            context_window = int(t_upper[:-1]) * 1024
        elif t_upper.endswith("M") and t_upper[:-1].isdigit():
            context_window = int(t_upper[:-1]) * 1024 * 1024

    return {
        "vision": has_vision,
        "reasoning": has_reasoning,
        "contextWindow": context_window,
        "maxTokens": min(131072, max(65536, context_window // 4)),
        "tags": tags,
    }


def _infer_provider(model_name: str) -> str:
    m = model_name.lower()
    if "deepseek" in m:
        return "deepseek"
    if "glm" in m or "chatglm" in m:
        return "zhipu"
    if "kimi" in m or "moonshot" in m:
        return "kimi"
    if "step" in m:
        return "stepfun"
    if "mimo" in m:
        return "mimo"
    if "minimax" in m:
        return "minimax"
    if "sensenova" in m:
        return "sensenova"
    if "claude" in m:
        return "anthropic"
    if "gpt" in m or "o1" in m or "o3" in m:
        return "openai"
    if "grok" in m:
        return "xai"
    if "hy" in m or "hunyuan" in m:
        return "hunyuan"
    return "custom"


def get_models_manifest(token: Optional[str] = None, force_refresh: bool = False, force_super: bool = False) -> dict:
    """获取面向客户端的完整模型清单与画廊规格配置。"""
    user_group = "super" if force_super else "default"
    is_super = bool(force_super)

    if not force_super and token:
        clean_key = token.strip()
        if clean_key.lower().startswith("bearer "):
            clean_key = clean_key[7:].strip()
        raw_key = clean_key
        if clean_key.lower().startswith("sk-"):
            clean_key = clean_key[3:].strip()

        esc_clean = clean_key.replace("'", "''")
        esc_raw = raw_key.replace("'", "''")

        user_sql = f"""
        SELECT t."group" AS token_group, u."group" AS user_group
        FROM tokens t
        LEFT JOIN users u ON t.user_id = u.id
        WHERE (t.key = '{esc_clean}' OR t.key = '{esc_raw}')
        LIMIT 1;
        """
        rows = _query_json(user_sql)
        if rows and isinstance(rows, list) and len(rows) > 0:
            tg = str(rows[0].get("token_group") or "").strip().lower()
            ug = str(rows[0].get("user_group") or "").strip().lower()
            if tg == "super" or ug == "super":
                is_super = True
                user_group = "super"
            elif tg:
                user_group = tg
            elif ug:
                user_group = ug

    cache_key = f"{user_group}:{is_super}"
    now_ts = int(time.time())
    cached = _MANIFEST_CACHE.get(cache_key)
    if not force_refresh and cached and (now_ts - cached["time"] < _MANIFEST_CACHE_TTL):
        return cached["data"]

    # 1. 查询所有当前渠道启用的模型列表
    active_models_raw = _query_json("SELECT DISTINCT model FROM abilities WHERE enabled = true;")
    active_set = set()
    if active_models_raw and isinstance(active_models_raw, list):
        for item in active_models_raw:
            m = str(item.get("model") or "").strip()
            if m:
                active_set.add(m)

    # 2. 查询 models 表元数据
    models_meta_raw = _query_json("SELECT model_name, description, tags FROM models WHERE deleted_at IS NULL;")
    models_meta = {}
    if models_meta_raw and isinstance(models_meta_raw, list):
        for item in models_meta_raw:
            mname = str(item.get("model_name") or "").strip()
            if mname:
                models_meta[mname] = item

    # 3. 查询 GroupRatio 折率
    ratios_raw = _query_json("SELECT value FROM options WHERE key = 'GroupRatio';")
    discounts = {"default": 1.0, "vip": 0.9, "svip": 0.8, "super": 0.8}
    if ratios_raw and isinstance(ratios_raw, list) and len(ratios_raw) > 0:
        try:
            val_str = ratios_raw[0].get("value")
            if val_str:
                val_json = json.loads(val_str)
                if isinstance(val_json, dict):
                    for k, v in val_json.items():
                        try:
                            discounts[str(k).lower()] = float(v)
                        except (ValueError, TypeError):
                            pass
        except Exception:
            pass

    # 4. 组装 imageModels (生图)
    image_models = []
    known_image_ids = set()
    for base_img in BASE_IMAGE_MODELS:
        mid = base_img["id"]
        known_image_ids.add(mid)
        item = dict(base_img)
        item["enabled"] = bool(mid in active_set)
        image_models.append(item)

    # 4b. 自动发现未登记的生图模型：New-API 上架新模型时，只要 models.tags 含 Image
    # 就纳入 imageModels（用通用默认元数据），避免新模型被误判成对话模型。
    # 这样运营在 New-API 上下架生图模型无需再改本文件常量。
    _AUTO_IMAGE_DEFAULTS = {
        "cost": 0.30,
        "vipCost": 0.24,
        "resolutions": ["1024x1024", "768x1344", "1344x768", "1024x1792", "1792x1024"],
        "singleNOnly": True,
        "badge": "生图",
    }
    _known_video_ids = {v["id"] for v in BASE_VIDEO_MODELS}
    for mid in sorted(active_set):
        if mid in known_image_ids or mid in _known_video_ids:
            continue
        meta = models_meta.get(mid) or {}
        tags = [t.strip().lower() for t in str(meta.get("tags") or "").split(",") if t.strip()]
        # 仅认明确的 Image 标签；排除 Video Generation / 纯 Vision 多模态对话模型
        if "image" not in tags and "image generation" not in tags and "drawing" not in tags:
            continue
        if any("video" in t for t in tags):
            continue
        desc = str(meta.get("description") or "").strip()
        image_models.append({
            "id": mid,
            "name": mid,
            "badge": _AUTO_IMAGE_DEFAULTS["badge"],
            "cost": _AUTO_IMAGE_DEFAULTS["cost"],
            "vipCost": _AUTO_IMAGE_DEFAULTS["vipCost"],
            "resolutions": list(_AUTO_IMAGE_DEFAULTS["resolutions"]),
            "singleNOnly": _AUTO_IMAGE_DEFAULTS["singleNOnly"],
            "desc": desc[:120],
            "enabled": True,
        })
        known_image_ids.add(mid)

    # 5. 组装 videoModels (生视频)
    video_models = []
    known_video_ids = set()
    for base_vid in BASE_VIDEO_MODELS:
        vid = base_vid["id"]
        known_video_ids.add(vid)
        item = dict(base_vid)
        item["enabled"] = bool(vid in active_set)
        video_models.append(item)

    # 6. 组装 chatModels (对话/推理模型)
    chat_models = []
    all_chat_candidates = set()
    for m in active_set:
        if m in known_image_ids or m in known_video_ids:
            continue
        all_chat_candidates.add(m)

    for m in BASE_CHAT_METADATA.keys():
        if m in known_image_ids or m in known_video_ids:
            continue
        all_chat_candidates.add(m)

    # 遍历对话模型
    for mid in sorted(all_chat_candidates):
        # 权限绝对红线：非 Super 严格不可见 deepseek-v4.1-flash-free 或任何 free 专供模型
        if not is_super and ("free" in mid.lower()):
            continue

        base_info = BASE_CHAT_METADATA.get(mid)
        meta_info = models_meta.get(mid)
        parsed_tags = _parse_model_tags(meta_info.get("tags") if meta_info else "")

        display_name = (
            (base_info.get("name") if base_info else None)
            or (meta_info.get("description") if meta_info and meta_info.get("description") and len(meta_info.get("description")) < 30 else None)
            or mid
        )
        provider = (base_info.get("provider") if base_info else None) or _infer_provider(mid)
        context_window = (base_info.get("contextWindow") if base_info else None) or parsed_tags["contextWindow"]
        max_tokens = (base_info.get("maxTokens") if base_info else None) or parsed_tags["maxTokens"]
        vision = (base_info.get("vision") if base_info else None) if base_info is not None and "vision" in base_info else parsed_tags["vision"]
        reasoning = (base_info.get("reasoning") if base_info else None) if base_info is not None and "reasoning" in base_info else parsed_tags["reasoning"]

        # 思考档位由服务器下发：BASE 单条声明优先，其次 deepseek 家族四档 (含 max)，其余推理模型三档
        efforts = None
        if reasoning:
            if base_info is not None and base_info.get("reasoningEfforts"):
                efforts = dict(base_info["reasoningEfforts"])
            elif "deepseek" in mid.lower():
                efforts = {"low": "low", "medium": "medium", "high": "high", "max": "max"}
            else:
                efforts = {"low": "low", "medium": "medium", "high": "high"}

        chat_models.append({
            "id": mid,
            "name": display_name,
            "provider": provider,
            "contextWindow": context_window,
            "maxTokens": max_tokens,
            "vision": bool(vision),
            "reasoning": bool(reasoning),
            "reasoningEfforts": efforts,
            "enabled": bool(mid in active_set),
        })

    result = {
        "ok": True,
        "updatedAt": now_ts,
        "group": user_group,
        "isSuper": is_super,
        "discounts": discounts,
        "chatModels": chat_models,
        "imageModels": image_models,
        "videoModels": video_models,
    }

    _MANIFEST_CACHE[cache_key] = {"time": now_ts, "data": result}
    return result


@router.get("/models/manifest")
async def subscription_models_manifest_endpoint(
    request: Request,
    authorization: Optional[str] = Header(None),
    key: Optional[str] = Query(None),
) -> JSONResponse:
    token_candidate = _extract_bearer_token(authorization) or key
    res = get_models_manifest(token=token_candidate)
    return JSONResponse(
        content=res,
        status_code=200,
        headers={"Cache-Control": "private, max-age=30", "Vary": "Authorization"}
    )
