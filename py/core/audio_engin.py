import os
import subprocess
import tempfile
import soundfile as sf
import numpy as np

from py.core.config import getFfmpegPath


class AudioProcessor:
    def __init__(
        self, audio_path: str, keep_format=True, default_sr=44100, default_ch=2
    ):
        self.audio_path = audio_path
        self.keep_format = keep_format
        self.default_sr = default_sr
        self.default_ch = default_ch

        info = sf.info(audio_path)
        self.sr = info.samplerate if keep_format else default_sr
        self.ch = info.channels if keep_format else default_ch
        self.duration = info.duration

        self.ffmpeg_path = getFfmpegPath()
        self.temp_path = self._create_tmp_file()

    def _create_tmp_file(self):
        os.makedirs(os.path.dirname(self.audio_path) or ".", exist_ok=True)
        tmp = tempfile.NamedTemporaryFile(
            delete=False, suffix=".wav", dir=os.path.dirname(self.audio_path) or "."
        )
        return tmp.name

    def _run_ffmpeg(self, cmd):
        subprocess.run(
            cmd,
            check=True,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )

    def _normalize(self, path):
        """防止音量削波"""
        data, sr = sf.read(path, dtype="float32", always_2d=True)
        peak = float(np.max(np.abs(data)))
        if peak > 1.0:
            data = data / peak
            sf.write(path, data, sr, format="WAV", subtype="PCM_16")

    # ---------------------- 模块功能 ---------------------- #

    def cut(self, start_ms: int, end_ms: int):
        """删除音频区间 [start_ms, end_ms]"""
        start_sec = start_ms / 1000
        end_sec = end_ms / 1000

        cmd = [
            self.ffmpeg_path,
            "-y",
            "-i",
            self.audio_path,
            "-filter_complex",
            f"[0:a]atrim=0:{start_sec},asetpts=PTS-STARTPTS[first];"
            f"[0:a]atrim={end_sec},asetpts=PTS-STARTPTS[second];"
            f"[first][second]concat=n=2:v=0:a=1[out]",
            "-map",
            "[out]",
            "-ar",
            str(self.sr),
            "-ac",
            str(self.ch),
            "-c:a",
            "pcm_s16le",
            self.temp_path,
        ]
        self._run_ffmpeg(cmd)
        os.replace(self.temp_path, self.audio_path)

    def insert_silence(self, insert_ms: int, duration_sec: float):
        """在指定时间点插入静音"""
        insert_sec = insert_ms / 1000
        cmd = [
            self.ffmpeg_path,
            "-y",
            "-i",
            self.audio_path,
            "-f",
            "lavfi",
            "-t",
            str(duration_sec),
            "-i",
            f"anullsrc=channel_layout={'stereo' if self.ch == 2 else 'mono'}:sample_rate={self.sr}",
            "-filter_complex",
            f"[0:a]atrim=0:{insert_sec},asetpts=PTS-STARTPTS[first];"
            f"[0:a]atrim={insert_sec},asetpts=PTS-STARTPTS[second];"
            f"[first][1:a][second]concat=n=3:v=0:a=1[out]",
            "-map",
            "[out]",
            "-ar",
            str(self.sr),
            "-ac",
            str(self.ch),
            "-c:a",
            "pcm_s16le",
            self.temp_path,
        ]
        self._run_ffmpeg(cmd)
        os.replace(self.temp_path, self.audio_path)

    def append_silence(self, duration_sec: float):
        """
        在音频末尾添加或裁剪静音段：
        - duration_sec > 0: 在末尾添加指定秒数静音
        - duration_sec < 0: 从末尾裁剪指定秒数的内容
        """
        if duration_sec == 0:
            return  # 无需处理

        # ---------- 情况1：添加静音 ----------
        if duration_sec > 0:
            cmd = [
                self.ffmpeg_path,
                "-y",
                "-i",
                self.audio_path,
                "-f",
                "lavfi",
                "-t",
                str(duration_sec),
                "-i",
                f"anullsrc=channel_layout={'stereo' if self.ch == 2 else 'mono'}:sample_rate={self.sr}",
                "-filter_complex",
                "[0:a][1:a]concat=n=2:v=0:a=1[out]",
                "-map",
                "[out]",
                "-ar",
                str(self.sr),
                "-ac",
                str(self.ch),
                "-c:a",
                "pcm_s16le",
                self.temp_path,
            ]

        # ---------- 情况2：裁剪末尾 ----------
        else:
            cut_dur = self.duration + duration_sec  # 因为 duration_sec 为负
            if cut_dur < 0:
                cut_dur = 0  # 防止全裁掉出错
            cmd = [
                self.ffmpeg_path,
                "-y",
                "-i",
                self.audio_path,
                "-filter_complex",
                f"[0:a]atrim=0:{cut_dur},asetpts=PTS-STARTPTS[out]",
                "-map",
                "[out]",
                "-ar",
                str(self.sr),
                "-ac",
                str(self.ch),
                "-c:a",
                "pcm_s16le",
                self.temp_path,
            ]

        # 执行 ffmpeg 命令
        self._run_ffmpeg(cmd)
        os.replace(self.temp_path, self.audio_path)
        # 更新音频时长（防止后续操作出错）
        info = sf.info(self.audio_path)
        self.duration = info.duration

    @staticmethod
    def _get_orig_path(audio_path: str) -> str:
        """获取原始音频备份路径: xxx.wav -> xxx.orig.wav"""
        base, ext = os.path.splitext(audio_path)
        return f"{base}.orig{ext}"

    def change_speed(self, speed: float):
        """
        变速处理 (0.5~2.0倍)
        采用"绝对变速"策略：始终从原始音频备份开始变速，避免累积误差。
        """
        speed = float(np.clip(speed, 0.5, 2.0))
        import shutil

        orig_path = self._get_orig_path(self.audio_path)
        if not os.path.exists(orig_path):
            # 首次变速，保存原始备份
            shutil.copy2(self.audio_path, orig_path)
            print(f"[AudioProcessor.变速] 首次变速，创建备份: {orig_path}")

        # speed=1.0 时直接恢复原始音频
        if abs(speed - 1.0) < 1e-6:
            shutil.copy2(orig_path, self.audio_path)
            # 恢复后删除备份，避免旧的被污染的备份被反复使用
            try:
                os.remove(orig_path)
                print(
                    f"[AudioProcessor.变速] speed=1.0 恢复原始并删除备份: {orig_path}"
                )
            except OSError:
                pass
            return

        # 始终从原始备份读取
        source_path = orig_path
        print(f"[AudioProcessor.变速] 从备份变速: speed={speed}, source={source_path}")
        cmd = [
            self.ffmpeg_path,
            "-y",
            "-i",
            source_path,
            "-af",
            f"atempo={speed}",
            "-ar",
            str(self.sr),
            "-ac",
            str(self.ch),
            "-c:a",
            "pcm_s16le",
            self.temp_path,
        ]
        self._run_ffmpeg(cmd)
        os.replace(self.temp_path, self.audio_path)

    def change_volume(self, volume: float):
        """音量调整"""
        volume = max(0.0, float(volume))
        cmd = [
            self.ffmpeg_path,
            "-y",
            "-i",
            self.audio_path,
            "-af",
            f"volume={volume}",
            "-ar",
            str(self.sr),
            "-ac",
            str(self.ch),
            "-c:a",
            "pcm_s16le",
            self.temp_path,
        ]
        self._run_ffmpeg(cmd)
        os.replace(self.temp_path, self.audio_path)

    def export(self, out_path: str):
        """导出音频到目标路径（带软限幅）"""
        self._normalize(self.audio_path)
        os.replace(self.audio_path, out_path)
        return out_path
