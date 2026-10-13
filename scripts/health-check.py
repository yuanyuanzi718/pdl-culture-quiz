#!/usr/bin/env python3
"""胖东来题库巡检脚本：健康检查 + 数据概览 + 微信推送"""
import json, urllib.request, urllib.error, sys
from datetime import datetime, timezone, timedelta

# ===== 配置 =====
HEALTH_URL = "https://jinhui.space/pdl-tiku/api/health"
STATS_URL  = "https://jinhui.space/pdl-tiku/api/admin/stats"
ADMIN_TOKEN = "Cjh10695138."
SERVER_CHAN_SENDKEY = "SCT438504TVepAPAN6hTZW3MJaNttYoApN"
# ================

def http_get(url, headers=None, timeout=10):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return 0, str(e)

# ---- 1. 健康检查 ----
status, body = http_get(HEALTH_URL)
health_ok = False
if status == 200:
    try:
        health_ok = json.loads(body).get("ok") is True
    except Exception:
        pass

# ---- 2. 管理端统计 ----
stats_status, stats_body = http_get(STATS_URL, headers={"x-admin-token": ADMIN_TOKEN}, timeout=15)
daily_block = ""
summary_block = ""
if stats_status == 200:
    try:
        data = json.loads(stats_body).get("data", {})
        daily = data.get("daily", [])
        # 汇总
        summary_block = (
            f"**总用户 {data.get('userCount', 0)}**  |  "
            f"题库 {data.get('questionCount', 0)}  |  "
            f"累计收款 {data.get('paidAmount', 0)} 元 ({data.get('paidOrderCount', 0)} 笔)\n"
            f"已激活 VIP **{data.get('activatedVipCount', 0)} 人**"
        )
        # 近 3 天
        rows = []
        for i in range(-3, 0):
            if abs(i) <= len(daily):
                d = daily[i]
                rows.append(
                    f"**{d.get('day','?')}**  "
                    f"访客 {d.get('visitors',0)}  "
                    f"新用户 {d.get('newUsers',0)}  "
                    f"考试 {d.get('exams',0)}({d.get('examUsers',0)}人)  "
                    f"对话 {d.get('chats',0)}({d.get('chatUsers',0)}人)  "
                    f"AI异常 {d.get('aiFailures',0)}"
                )
        daily_block = "\n\n".join(rows)
    except Exception as e:
        daily_block = f"解析失败: {e}"
else:
    daily_block = f"拉取失败 (HTTP {stats_status})"

# ---- 3. 组装 Markdown ----
now_str = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")

if health_ok:
    title = "胖东来题库巡检正常"
    status_line = "✅ 服务正常运行 (HTTP 200)"
else:
    title = "⚠️ 胖东来题库线上告警"
    status_line = (
        f"❌ **HTTP {status}**\n"
        f"接口: `{HEALTH_URL}`\n"
        f"响应: `{body[:200]}`\n\n"
        f"**排查命令:**\n"
        f"```\nssh root@39.105.227.38\nsystemctl status pdltk\njournalctl -u pdltk -n 50 --no-pager\n```"
    )

desp = f"""### {title}

> 巡检时间 **{now_str}**

{status_line}

---

### 📊 数据概览

{summary_block}

**近 3 天明细**

{daily_block}
"""

# ---- 4. 推送 ----
payload = json.dumps({"title": title, "desp": desp}).encode("utf-8")
req = urllib.request.Request(
    f"https://sctapi.ftqq.com/{SERVER_CHAN_SENDKEY}.send",
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        result = r.read().decode()
        print(f"[{now_str}] 健康:{health_ok} 推送成功 {result[:100]}")
except Exception as e:
    print(f"[{now_str}] 健康:{health_ok} 推送失败: {e}")
    sys.exit(1)
