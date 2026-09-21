import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ReportProgressDto {
  // 当前播放位置（秒）
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position: number;

  // 视频总时长（秒）
  @Type(() => Number)
  @IsInt()
  @Min(1)
  duration: number;
}
