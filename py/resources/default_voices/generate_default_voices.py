#!/usr/bin/env python3
"""
生成默认音色参考音频 —— 初始化资源包脚本

使用 edge-tts（微软免费 TTS）为每个预设音色生成一段参考音频。
这些音频将作为 Index-TTS 的声音克隆参考，跟随项目一起分发。

使用方法：
  1. 安装依赖：  pip install edge-tts
  2. 运行脚本：  python py/resources/default_voices/generate_default_voices.py

音频文件会生成到 py/resources/default_voices/ 目录下。
你也可以手动替换这些 .wav 文件为更合适的参考音频。
"""

import asyncio
import json
import os
import sys

try:
    import edge_tts
except ImportError:
    print("❌ 请先安装 edge-tts：pip install edge-tts")
    sys.exit(1)


# 脚本所在目录就是资源包目录
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VOICES_JSON = os.path.join(SCRIPT_DIR, "voices.json")


async def generate_one(voice_cfg: dict) -> bool:
    """为单个音色生成参考音频"""
    name = voice_cfg["name"]
    audio_file = voice_cfg["audio_file"]
    output_path = os.path.join(SCRIPT_DIR, audio_file)

    # 如果已存在则跳过
    if os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
        print(f"  ⏭️  {name} — 已存在，跳过")
        return True

    tts_voice = voice_cfg.get("edge_tts_voice", "zh-CN-YunxiNeural")
    rate = voice_cfg.get("edge_tts_rate", "+0%")
    pitch = voice_cfg.get("edge_tts_pitch", "+0Hz")
    text = voice_cfg.get("sample_text", "这是一段默认的参考音频。")

    print(f"  🎙️  {name} — 使用 {tts_voice} (rate={rate}, pitch={pitch})")

    try:
        communicate = edge_tts.Communicate(text, tts_voice, rate=rate, pitch=pitch)
        # edge-tts 输出 mp3，先保存为 mp3 再看是否需要转换
        mp3_path = output_path.replace(".wav", ".mp3")
        await communicate.save(mp3_path)

        # 尝试用 ffmpeg 转换为 wav（Index-TTS 更喜欢 wav）
        try:
            import subprocess

            result = subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    mp3_path,
                    "-ar",
                    "22050",
                    "-ac",
                    "1",
                    output_path,
                ],
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                os.remove(mp3_path)
            else:
                # ffmpeg 失败，直接用 mp3 重命名
                os.rename(mp3_path, output_path)
                print(f"    ⚠️  ffmpeg 转换失败，使用 mp3 格式")
        except FileNotFoundError:
            # 没有 ffmpeg，直接用 mp3
            os.rename(mp3_path, output_path)
            print(
                f"    ⚠️  未找到 ffmpeg，使用 mp3 格式（建议安装 ffmpeg 获得更好效果）"
            )

        print(f"  ✅  {name} — 生成完成")
        return True

    except Exception as e:
        print(f"  ❌  {name} — 生成失败: {e}")
        return False


async def main():
    print("=" * 50)
    print("🎵 HX-SayBook 默认音色参考音频生成器")
    print("=" * 50)

    # 读取配置
    if not os.path.exists(VOICES_JSON):
        print(f"❌ 找不到配置文件: {VOICES_JSON}")
        sys.exit(1)

    with open(VOICES_JSON, "r", encoding="utf-8") as f:
        voices = json.load(f)

    print(f"\n📋 共 {len(voices)} 个音色待生成\n")

    success = 0
    failed = 0
    for voice_cfg in voices:
        ok = await generate_one(voice_cfg)
        if ok:
            success += 1
        else:
            failed += 1

    print(f"\n{'=' * 50}")
    print(f"📊 完成：成功 {success} 个，失败 {failed} 个")

    if success > 0:
        print(f"\n💡 音频已保存到: {SCRIPT_DIR}")
        print(f"💡 你可以手动替换这些音频文件为更合适的参考音频")
        print(f"💡 建议使用 5-15 秒、单人清晰朗读的音频效果最佳")

    print()


if __name__ == "__main__":
    asyncio.run(main())
