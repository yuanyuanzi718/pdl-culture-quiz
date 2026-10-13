#!/bin/bash
# 入口：调用 Python 巡检脚本（cron 每 3 天 9 点触发）
# crontab: 0 9 */3 * * /opt/projects/pdltk/scripts/health-check.sh >> /opt/projects/pdltk/scripts/cron.log 2>&1
cd /opt/projects/pdltk/scripts
python3 health-check.py >> /opt/projects/pdltk/scripts/health-check.log 2>&1
