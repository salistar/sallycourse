// Tests de validité des templates de cours (Prompt 58) :
// chaque template respecte son schéma ET produit un draft valide contre
// createCourseInputSchema. On vérifie aussi les helpers (draft, %).
import { describe, expect, it } from 'vitest';
import { createCourseInputSchema, lessonTypeSchema } from './schemas/course';
import {
  COURSE_TEMPLATES,
  COURSE_TONE_LABELS,
  TEMPLATE_CATEGORY_LABELS,
  courseTemplateSchema,
  getCourseTemplate,
  lessonMixPercentages,
  lessonMixSchema,
  templateToCourseDraft,
  templatesByCategory,
  type CourseTone,
  type TemplateCategory,
} from './course-templates';

describe('bibliothèque de templates', () => {
  it('contient au moins les 4 niches demandées', () => {
    const categories = new Set(COURSE_TEMPLATES.map((t) => t.category));
    expect(categories).toEqual(new Set(['devops', 'office', 'languages', 'business']));
  });

  it('les identifiants sont uniques', () => {
    const ids = COURSE_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(COURSE_TEMPLATES.map((t) => [t.id, t] as const))(
    'template %s respecte courseTemplateSchema',
    (_id, template) => {
      expect(() => courseTemplateSchema.parse(template)).not.toThrow();
    },
  );

  it.each(COURSE_TEMPLATES.map((t) => [t.id, t] as const))(
    'template %s produit un draft valide contre createCourseInputSchema',
    (_id, template) => {
      const draft = templateToCourseDraft(template);
      const result = createCourseInputSchema.safeParse(draft);
      expect(result.success).toBe(true);
    },
  );

  it.each(COURSE_TEMPLATES.map((t) => [t.id, t] as const))(
    'chaque titre d’exemple du template %s passe le schéma de titre',
    (_id, template) => {
      for (const title of template.exampleTitles) {
        const result = createCourseInputSchema.safeParse({
          title,
          difficulty: template.difficulty,
          locale: template.locale,
          approxSections: template.sections,
        });
        expect(result.success).toBe(true);
      }
    },
  );

  it('le lessonMix de chaque template n’utilise que des types de leçon connus', () => {
    const known = new Set(lessonTypeSchema.options);
    for (const template of COURSE_TEMPLATES) {
      for (const key of Object.keys(template.lessonMix)) {
        expect(known.has(key as (typeof lessonTypeSchema.options)[number])).toBe(true);
      }
    }
  });

  it('chaque catégorie a un libellé, chaque ton a un libellé', () => {
    for (const template of COURSE_TEMPLATES) {
      expect(TEMPLATE_CATEGORY_LABELS[template.category as TemplateCategory]).toBeTruthy();
      expect(COURSE_TONE_LABELS[template.tone as CourseTone]).toBeTruthy();
    }
  });
});

describe('getCourseTemplate / templatesByCategory', () => {
  it('retrouve un template existant par id', () => {
    const first = COURSE_TEMPLATES[0]!;
    expect(getCourseTemplate(first.id)).toEqual(first);
  });

  it('retourne undefined pour un id inconnu', () => {
    expect(getCourseTemplate('inconnu-xyz')).toBeUndefined();
  });

  it('filtre correctement par catégorie', () => {
    const devops = templatesByCategory('devops');
    expect(devops.length).toBeGreaterThan(0);
    expect(devops.every((t) => t.category === 'devops')).toBe(true);
  });
});

describe('lessonMixSchema', () => {
  it('rejette un mix entièrement nul', () => {
    const result = lessonMixSchema.safeParse({ video: 0, article: 0, tp: 0, quiz: 0 });
    expect(result.success).toBe(false);
  });

  it('accepte un mix avec un seul type non nul', () => {
    const result = lessonMixSchema.safeParse({ video: 3 });
    expect(result.success).toBe(true);
  });
});

describe('lessonMixPercentages', () => {
  it('somme exactement à 100 pour chaque template', () => {
    for (const template of COURSE_TEMPLATES) {
      const pct = lessonMixPercentages(template.lessonMix);
      const total = pct.video + pct.article + pct.tp + pct.quiz;
      expect(total).toBe(100);
    }
  });

  it('retourne des zéros pour un total nul', () => {
    const pct = lessonMixPercentages({ video: 0, article: 0, tp: 0, quiz: 0 });
    expect(pct).toEqual({ video: 0, article: 0, tp: 0, quiz: 0 });
  });

  it('répartit correctement un mix simple 1/1/1/1', () => {
    const pct = lessonMixPercentages({ video: 1, article: 1, tp: 1, quiz: 1 });
    const total = pct.video + pct.article + pct.tp + pct.quiz;
    expect(total).toBe(100);
    // 100 / 4 = 25 chacun.
    expect(pct.video).toBe(25);
  });
});
