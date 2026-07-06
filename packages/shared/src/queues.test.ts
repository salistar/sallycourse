// Tests du module queues : jobId déterministe, constantes, types et pub/sub.
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  QUEUES,
  QUEUE_NAMES,
  defaultJobOptions,
  makeJobId,
  PROGRESS_CHANNEL,
  progressEventSchema,
  publishProgress,
  subscribeProgress,
  type ContentJobData,
  type OutlineJobData,
  type ProgressEvent,
  type QueueJobData,
  type QueueName,
  type RedisPublisherLike,
  type RedisSubscriberLike,
} from './queues';

describe('QUEUES', () => {
  it('expose les 8 queues du pipeline, sans doublon', () => {
    expect(QUEUE_NAMES).toHaveLength(8);
    expect(new Set(QUEUE_NAMES).size).toBe(8);
    expect(QUEUE_NAMES).toEqual([
      'outline-generation',
      'content-generation',
      'tts-generation',
      'screenshot-capture',
      'video-render',
      'subtitle-generation',
      'packaging',
      'deployment',
    ]);
    expect(QUEUES.outline).toBe('outline-generation');
  });
});

describe('makeJobId', () => {
  it('est déterministe pour un même couple (courseId, step)', () => {
    expect(makeJobId('c1', QUEUES.outline)).toBe(makeJobId('c1', QUEUES.outline));
    expect(makeJobId('c1', QUEUES.outline)).toBe('outline-generation:c1');
  });

  it('distingue cours, steps et suffixes', () => {
    expect(makeJobId('c1', QUEUES.outline)).not.toBe(makeJobId('c2', QUEUES.outline));
    expect(makeJobId('c1', QUEUES.outline)).not.toBe(makeJobId('c1', QUEUES.packaging));
    expect(makeJobId('c1', QUEUES.content, 'lesson-9')).toBe('content-generation:c1:lesson-9');
  });
});

describe('defaultJobOptions', () => {
  it('applique 3 tentatives, backoff exponentiel 5s et rétention bornée', () => {
    expect(defaultJobOptions.attempts).toBe(3);
    expect(defaultJobOptions.backoff).toEqual({ type: 'exponential', delay: 5000 });
    expect(defaultJobOptions.removeOnComplete).toBe(100);
    expect(defaultJobOptions.removeOnFail).toBe(500);
  });
});

describe('types QueueJobData', () => {
  it('la map couvre exactement les noms de queues', () => {
    expectTypeOf<keyof QueueJobData>().toEqualTypeOf<QueueName>();
  });

  it('associe les bons payloads aux queues', () => {
    expectTypeOf<QueueJobData['outline-generation']>().toEqualTypeOf<OutlineJobData>();
    expectTypeOf<QueueJobData['content-generation']>().toEqualTypeOf<ContentJobData>();
    expectTypeOf<QueueJobData['outline-generation']>().toEqualTypeOf<{
      courseId: string;
      extraInstructions?: string;
    }>();
    expectTypeOf<QueueJobData['tts-generation']>().toMatchTypeOf<{
      courseId: string;
      lessonId: string;
    }>();
    expectTypeOf<QueueJobData['packaging']>().not.toHaveProperty('lessonId');
  });

  it('makeJobId exige un QueueName comme step', () => {
    expectTypeOf(makeJobId).parameter(1).toEqualTypeOf<QueueName>();
  });
});

describe('progression pub/sub', () => {
  const event: ProgressEvent = {
    courseId: 'course-42',
    step: QUEUES.tts,
    progress: 55,
    message: 'Synthèse vocale leçon 3',
    level: 'info',
    ts: 1_720_000_000_000,
  };

  it('PROGRESS_CHANNEL est déterministe et scellé par cours', () => {
    expect(PROGRESS_CHANNEL('c1')).toBe('sallycourse:progress:c1');
    expect(PROGRESS_CHANNEL('c1')).not.toBe(PROGRESS_CHANNEL('c2'));
  });

  it('progressEventSchema valide un événement conforme et rejette un step inconnu', () => {
    expect(progressEventSchema.safeParse(event).success).toBe(true);
    expect(progressEventSchema.safeParse({ ...event, step: 'inconnu' }).success).toBe(false);
    expect(progressEventSchema.safeParse({ ...event, progress: 120 }).success).toBe(false);
  });

  it('publishProgress publie le JSON sur le canal du cours', async () => {
    const publish = vi.fn().mockResolvedValue(1);
    const redis: RedisPublisherLike = { publish };
    await publishProgress(redis, event);
    expect(publish).toHaveBeenCalledWith(PROGRESS_CHANNEL(event.courseId), JSON.stringify(event));
  });

  it('subscribeProgress relaie les événements parsés puis se désabonne', async () => {
    // Faux client Redis subscribe minimal (compatible structurellement ioredis).
    let listener: ((chan: string, msg: string) => void) | undefined;
    const redis: RedisSubscriberLike = {
      subscribe: vi.fn().mockResolvedValue(1),
      unsubscribe: vi.fn().mockResolvedValue(1),
      on: (_evt, cb) => {
        listener = cb;
        return undefined;
      },
      off: vi.fn(),
    };

    const received: ProgressEvent[] = [];
    const unsubscribe = await subscribeProgress(redis, event.courseId, (e) => received.push(e));

    expect(redis.subscribe).toHaveBeenCalledWith(PROGRESS_CHANNEL(event.courseId));
    listener?.(PROGRESS_CHANNEL(event.courseId), JSON.stringify(event));
    listener?.(PROGRESS_CHANNEL('autre-cours'), JSON.stringify({ ...event, courseId: 'autre-cours' }));
    listener?.(PROGRESS_CHANNEL(event.courseId), 'pas-du-json');

    expect(received).toEqual([event]);

    await unsubscribe();
    expect(redis.unsubscribe).toHaveBeenCalledWith(PROGRESS_CHANNEL(event.courseId));
    expect(redis.off).toHaveBeenCalled();
  });
});
