import { Modal, Select, Space, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { courseApi } from '@/api/course';
import { CourseLesson } from '@/types/course';

const { Text } = Typography;

// 播放中每隔多少秒上报一次进度
const REPORT_INTERVAL_SECONDS = 5;
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface LessonPlayerProps {
  courseId: string;
  lesson: CourseLesson | null;
  initialPosition: number;
  open: boolean;
  onClose: () => void;
}

export default function LessonPlayer({ courseId, lesson, initialPosition, open, onClose }: LessonPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  // 用 ref 保存上报上下文，保证事件回调里读到最新值
  const reportContextRef = useRef({ courseId, lesson, lastReported: -1, completed: false });
  reportContextRef.current.courseId = courseId;
  reportContextRef.current.lesson = lesson;

  useEffect(() => {
    if (open) {
      reportContextRef.current.lastReported = -1;
      reportContextRef.current.completed = false;
      setPlaybackRate(1);
    }
  }, [open, lesson?.id]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const reportProgress = async (force = false) => {
    const video = videoRef.current;
    const { courseId: currentCourseId, lesson: currentLesson } = reportContextRef.current;
    if (!video || !currentLesson || !video.duration || Number.isNaN(video.duration)) return;

    const duration = Math.floor(video.duration);
    const position = Math.min(Math.floor(video.currentTime), duration);
    if (duration <= 0) return;
    if (!force && position - reportContextRef.current.lastReported < REPORT_INTERVAL_SECONDS) return;
    if (position === reportContextRef.current.lastReported && !force) return;
    reportContextRef.current.lastReported = position;

    try {
      const updated = await courseApi.reportProgress(currentCourseId, currentLesson.id, { position, duration });
      if (updated.completed && !reportContextRef.current.completed) {
        reportContextRef.current.completed = true;
        message.success('恭喜，本课时已完成');
      }
    } catch {
      // 上报失败时静默处理，等待下次定时上报
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
    // 断点续播：从上次的有效位置继续播放
    if (initialPosition > 0 && initialPosition < video.duration) {
      video.currentTime = initialPosition;
    }
  };

  const handleClose = () => {
    // 关闭前做最后一次上报，随后暂停播放
    reportProgress(true);
    videoRef.current?.pause();
    onClose();
  };

  return (
    <Modal
      open={open}
      title={lesson?.title || '课时播放'}
      footer={null}
      onCancel={handleClose}
      width={840}
      destroyOnClose
    >
      {lesson?.videoUrl && (
        <video
          ref={videoRef}
          src={lesson.videoUrl}
          controls
          autoPlay
          style={{ width: '100%', maxHeight: 460, background: '#000' }}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={() => reportProgress(false)}
          onPause={() => reportProgress(true)}
          onEnded={() => reportProgress(true)}
        />
      )}
      <Space style={{ marginTop: 12 }}>
        <Text>倍速</Text>
        <Select
          value={playbackRate}
          onChange={setPlaybackRate}
          style={{ width: 100 }}
          options={PLAYBACK_RATES.map((rate) => ({ value: rate, label: `${rate}x` }))}
        />
        {initialPosition > 0 && (
          <Text type="secondary">已从上次的播放位置继续</Text>
        )}
      </Space>
    </Modal>
  );
}
