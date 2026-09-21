import { Card, Typography, Button, Space, Tag, Progress, message, Spin } from 'antd';
import { ArrowLeftOutlined, CheckCircleFilled } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { courseApi } from '@/api/course';
import { api } from '@/api';
import { CourseLesson, LessonProgress } from '@/types/course';

const { Title, Text } = Typography;

/** 播放到总时长 95% 标记完成，与后端阈值保持一致 */
const COMPLETION_THRESHOLD = 0.95;
/** 播放期间进度上报间隔（毫秒） */
const REPORT_INTERVAL = 5000;

export default function LessonPlayer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [lesson, setLesson] = useState<CourseLesson | null>(null);
  const [progress, setProgress] = useState<LessonProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [percent, setPercent] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [denied, setDenied] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastReportRef = useRef(0);
  const reportingRef = useRef(false);
  const completedRef = useRef(false);
  const resumeAppliedRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const lessonData = await courseApi.getLesson(id);
        if (lessonData.isLive) {
          // 直播课时保持原入口
          navigate(`/live/${id}`, { replace: true });
          return;
        }
        setLesson(lessonData);
        try {
          const saved = await courseApi.getLessonProgress(id);
          if (saved) {
            setProgress(saved);
            setCompleted(saved.completed);
            completedRef.current = saved.completed;
            setPercent(saved.duration ? Math.min(100, (saved.position / saved.duration) * 100) : 0);
          }
        } catch {
          // 未报名等 403：播放页仍提示，不允许上报
        }
      } catch (error: any) {
        message.error(error.response?.data?.message || '课时加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, navigate]);

  /** 上报当前位置；服务端保证只增不减、完成不可回退 */
  const report = async (force = false) => {
    const video = videoRef.current;
    if (!id || !video || !video.duration || reportingRef.current) return;
    const now = Date.now();
    if (!force && now - lastReportRef.current < REPORT_INTERVAL) return;
    lastReportRef.current = now;

    reportingRef.current = true;
    try {
      const updated = await courseApi.reportLessonProgress(id, {
        position: video.currentTime,
        duration: video.duration,
      });
      setProgress(updated);
      if (updated.completed) {
        completedRef.current = true;
        setCompleted(true);
      }
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 403) {
        setDenied(true);
      }
    } finally {
      reportingRef.current = false;
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video || !progress || resumeAppliedRef.current) return;
    resumeAppliedRef.current = true;
    // 从续播位置继续；接近片尾时回退 2 秒避免直接触发结束
    const resumeAt = Math.min(progress.position, Math.max(0, video.duration - 2));
    if (resumeAt > 0) {
      video.currentTime = resumeAt;
      message.info(`从上次位置 ${Math.floor(resumeAt)}s 继续播放`);
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const ratio = video.currentTime / video.duration;
    setPercent(Math.min(100, ratio * 100));
    if (ratio >= COMPLETION_THRESHOLD && !completedRef.current) {
      completedRef.current = true;
      setCompleted(true);
      message.success('课时已完成');
    }
    report();
  };

  const handlePause = () => report(true);

  const handleEnded = () => {
    completedRef.current = true;
    setCompleted(true);
    report(true);
  };

  // 离开页面/切后台时尽力补报一次
  useEffect(() => {
    const flush = () => {
      const video = videoRef.current;
      if (!id || !video || !video.duration) return;
      const token = localStorage.getItem('accessToken');
      if (!token) return;
      const payload = JSON.stringify({ position: video.currentTime, duration: video.duration });
      try {
        fetch(`${api.defaults.baseURL}/courses/lessons/${id}/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: payload,
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        // ignore
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [id]);

  if (loading) {
    return (
      <Card style={{ textAlign: 'center', padding: 80 }}>
        <Spin tip="加载中..." />
      </Card>
    );
  }

  if (!lesson) {
    return <Card>课时不存在</Card>;
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回课程
        </Button>
        <Title level={3} style={{ margin: 0 }}>
          {lesson.title}
        </Title>
        {completed && (
          <Tag icon={<CheckCircleFilled />} color="success">
            已完成
          </Tag>
        )}
      </Space>

      <Card>
        {lesson.videoUrl ? (
          <video
            ref={videoRef}
            src={lesson.videoUrl}
            controls
            autoPlay
            style={{ width: '100%', maxHeight: 560, background: '#000', borderRadius: 8 }}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPause={handlePause}
            onEnded={handleEnded}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: 80 }}>
            <Text type="secondary">暂无录播视频</Text>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong>本课时进度</Text>
            <Text type="secondary">
              {completed ? '已完成' : `观看到 ${percent.toFixed(0)}%`}
            </Text>
          </Space>
          <Progress
            percent={completed ? 100 : Number(percent.toFixed(1))}
            status={completed ? 'success' : 'active'}
            strokeColor={completed ? '#52c41a' : '#1890ff'}
          />
          {progress?.position ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              续播位置：{Math.floor(progress.position)}s
              {progress.duration ? ` / ${Math.floor(progress.duration)}s` : ''}
            </Text>
          ) : null}
          {denied && (
            <div style={{ marginTop: 8 }}>
              <Text type="warning">仅报名该课程的学生可记录学习进度</Text>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
