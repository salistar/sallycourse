// Tests de la duplication à l'achat marketplace (Prompt 147) : Mongo mocké,
// vérifie la copie Course+Section+Lesson+Quiz et l'idempotence par providerRef.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCourseFindById = vi.hoisted(() => vi.fn());
const mockCourseCreate = vi.hoisted(() => vi.fn());
const mockSectionFind = vi.hoisted(() => vi.fn());
const mockSectionCreate = vi.hoisted(() => vi.fn());
const mockLessonFind = vi.hoisted(() => vi.fn());
const mockLessonCreate = vi.hoisted(() => vi.fn());
const mockQuizFindOne = vi.hoisted(() => vi.fn());
const mockQuizCreate = vi.hoisted(() => vi.fn());
const mockListingFindById = vi.hoisted(() => vi.fn());
const mockListingUpdateOne = vi.hoisted(() => vi.fn(async () => ({ acknowledged: true })));
const mockPurchaseFindOne = vi.hoisted(() => vi.fn());
const mockPurchaseCreate = vi.hoisted(() => vi.fn());

vi.mock('../shared.js', async () => {
  const actual = await vi.importActual<typeof import('../shared.js')>('../shared.js');
  return {
    ...actual,
    Course: { findById: mockCourseFindById, create: mockCourseCreate },
    Section: { find: mockSectionFind, create: mockSectionCreate },
    Lesson: { find: mockLessonFind, create: mockLessonCreate },
    Quiz: { findOne: mockQuizFindOne, create: mockQuizCreate },
    CourseMarketplaceListing: { findById: mockListingFindById, updateOne: mockListingUpdateOne },
    CourseMarketplacePurchase: { findOne: mockPurchaseFindOne, create: mockPurchaseCreate },
  };
});

import { processMarketplacePurchase } from './marketplace-purchase.js';

/** Construit un objet { sort, lean } ou { lean } chaînable renvoyant `data`. */
function lean<T>(data: T) {
  return { lean: async () => data };
}
function sortLean<T>(data: T) {
  return { sort: () => ({ lean: async () => data }) };
}

beforeEach(() => {
  mockCourseFindById.mockReset();
  mockCourseCreate.mockReset();
  mockSectionFind.mockReset();
  mockSectionCreate.mockReset();
  mockLessonFind.mockReset();
  mockLessonCreate.mockReset();
  mockQuizFindOne.mockReset();
  mockQuizCreate.mockReset();
  mockListingFindById.mockReset();
  mockListingUpdateOne.mockClear();
  mockPurchaseFindOne.mockReset();
  mockPurchaseCreate.mockReset();
});

const baseListing = {
  _id: 'listing1',
  courseId: 'sourceCourse1',
  sellerId: 'seller1',
  priceCents: 10000,
  currency: 'MAD',
  platformFeeRate: 0.2,
  licenseType: 'course-copy',
  status: 'active',
};

describe('processMarketplacePurchase', () => {
  it('refuse un listing introuvable', async () => {
    mockListingFindById.mockReturnValue(lean(null));
    const result = await processMarketplacePurchase({
      listingId: 'nope',
      buyerId: 'buyer1',
      provider: 'mock',
      providerRef: 'ref1',
    });
    expect(result).toEqual({ ok: false, reason: 'listing_not_found' });
  });

  it('refuse un listing non actif (paused/removed)', async () => {
    mockListingFindById.mockReturnValue(lean({ ...baseListing, status: 'paused' }));
    const result = await processMarketplacePurchase({
      listingId: 'listing1',
      buyerId: 'buyer1',
      provider: 'mock',
      providerRef: 'ref1',
    });
    expect(result).toEqual({ ok: false, reason: 'listing_inactive' });
  });

  it('idempotence : rejouer le même providerRef ne duplique pas deux fois le cours', async () => {
    mockListingFindById.mockReturnValue(lean(baseListing));
    mockPurchaseFindOne.mockReturnValue(
      lean({ _id: 'purchaseExisting', deliveredCourseId: 'deliveredCourseX' }),
    );

    const result = await processMarketplacePurchase({
      listingId: 'listing1',
      buyerId: 'buyer1',
      provider: 'mock',
      providerRef: 'ref-idempotent',
    });

    expect(result).toEqual({ ok: true, deliveredCourseId: 'deliveredCourseX', purchaseId: 'purchaseExisting' });
    expect(mockCourseCreate).not.toHaveBeenCalled();
  });

  it('duplique Course + Section + Lesson + Quiz pour une licence course-copy', async () => {
    mockListingFindById.mockReturnValue(lean(baseListing));
    mockPurchaseFindOne.mockReturnValueOnce(lean(null));

    mockCourseFindById.mockReturnValue(
      lean({
        _id: 'sourceCourse1',
        title: 'Cours source',
        difficulty: 'beginner',
        locale: 'fr',
        outline: { title: 'Cours source' },
        ttsVoice: 'voice1',
        watermark: false,
      }),
    );
    mockCourseCreate.mockResolvedValue({ _id: 'deliveredCourse1' });

    mockSectionFind.mockReturnValue(sortLean([{ _id: 'sec1', order: 0, title: 'Section 1' }]));
    mockSectionCreate.mockResolvedValue({ _id: 'newSec1' });

    mockLessonFind.mockReturnValue(
      sortLean([
        {
          _id: 'lesson1',
          order: 0,
          title: 'Leçon 1',
          type: 'video',
          status: 'ready',
          durationMin: 5,
          summary: 'résumé',
          assets: { videoUrl: 'x' },
        },
        {
          _id: 'lessonQuiz',
          order: 1,
          title: 'Quiz',
          type: 'quiz',
          status: 'ready',
          assets: {},
        },
      ]),
    );
    mockLessonCreate
      .mockResolvedValueOnce({ _id: 'newLesson1' })
      .mockResolvedValueOnce({ _id: 'newLessonQuiz' });

    mockQuizFindOne.mockReturnValue(lean({ questions: [{ question: 'Q1', choices: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: '' }] }));
    mockQuizCreate.mockResolvedValue({ _id: 'newQuiz1' });

    mockPurchaseCreate.mockResolvedValue({ _id: 'purchase1' });

    const result = await processMarketplacePurchase({
      listingId: 'listing1',
      buyerId: 'buyer1',
      provider: 'mock',
      providerRef: 'ref-new',
    });

    expect(result.ok).toBe(true);
    expect(result.deliveredCourseId).toBe('deliveredCourse1');

    // Course dupliqué appartient au buyer, pas au vendeur.
    expect(mockCourseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'buyer1', title: 'Cours source', status: 'ready' }),
    );
    expect(mockSectionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'deliveredCourse1', order: 0, title: 'Section 1' }),
    );
    expect(mockLessonCreate).toHaveBeenCalledTimes(2);
    expect(mockQuizCreate).toHaveBeenCalledWith(
      expect.objectContaining({ lessonId: 'newLessonQuiz', courseId: 'deliveredCourse1' }),
    );

    // Revenue share calculé et persisté (20% de 10000 = 2000 commission / 8000 net).
    expect(mockPurchaseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        priceCents: 10000,
        platformFeeCents: 2000,
        sellerNetCents: 8000,
        provider: 'mock',
        providerRef: 'ref-new',
        deliveredCourseId: 'deliveredCourse1',
      }),
    );
    expect(mockListingUpdateOne).toHaveBeenCalledWith(
      { _id: 'listing1' },
      { $inc: { salesCount: 1, netRevenueCents: 8000 } },
    );
  });

  it('licence template-only : aucune duplication de Course, purchase sans deliveredCourseId', async () => {
    mockListingFindById.mockReturnValue(lean({ ...baseListing, licenseType: 'template-only', priceCents: 0 }));
    mockPurchaseFindOne.mockReturnValueOnce(lean(null));
    mockPurchaseCreate.mockResolvedValue({ _id: 'purchaseTemplate' });

    const result = await processMarketplacePurchase({
      listingId: 'listing1',
      buyerId: 'buyer1',
      provider: 'free',
      providerRef: 'ref-template',
    });

    expect(result.ok).toBe(true);
    expect(result.deliveredCourseId).toBeUndefined();
    expect(mockCourseCreate).not.toHaveBeenCalled();
    expect(mockPurchaseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ deliveredCourseId: null, priceCents: 0, platformFeeCents: 0, sellerNetCents: 0 }),
    );
  });

  it('renvoie course_missing si le cours source a disparu', async () => {
    mockListingFindById.mockReturnValue(lean(baseListing));
    mockPurchaseFindOne.mockReturnValueOnce(lean(null));
    mockCourseFindById.mockReturnValue(lean(null));

    const result = await processMarketplacePurchase({
      listingId: 'listing1',
      buyerId: 'buyer1',
      provider: 'mock',
      providerRef: 'ref-missing',
    });

    expect(result).toEqual({ ok: false, reason: 'course_missing' });
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });
});
