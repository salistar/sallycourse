import { describe, expect, it } from 'vitest';
import {
  aggregateAgencyBilling,
  isCredentialAllowedForAgencyCourse,
  resolveAgencyDeployCredentials,
  type AgencyClientLike,
} from './agency';

const client = (overrides: Partial<AgencyClientLike> = {}): AgencyClientLike => ({
  id: 'client-1',
  agencyUserId: 'agency-1',
  clientName: 'Académie Dupont',
  clientEmail: 'contact@academie-dupont.fr',
  platformCredentials: ['cred-client-1', 'cred-client-2'],
  ...overrides,
});

describe('resolveAgencyDeployCredentials — isolation des credentials par client', () => {
  it("cours sans agencyClientId : pas de contexte agence, aucune restriction", () => {
    const result = resolveAgencyDeployCredentials({ userId: 'agency-1', agencyClientId: null }, null);
    expect(result.isAgencyContext).toBe(false);
    expect(result.allowedCredentialIds).toEqual([]);
  });

  it('cours en contexte agence : seuls les credentials DU CLIENT sont autorisés (jamais ceux de l’agence)', () => {
    const result = resolveAgencyDeployCredentials(
      { userId: 'agency-1', agencyClientId: 'client-1' },
      client(),
    );
    expect(result.isAgencyContext).toBe(true);
    expect(result.allowedCredentialIds).toEqual(['cred-client-1', 'cred-client-2']);
    expect(result.reason).toBeUndefined();
  });

  it('client introuvable : fail-closed, aucun credential autorisé', () => {
    const result = resolveAgencyDeployCredentials(
      { userId: 'agency-1', agencyClientId: 'client-1' },
      null,
    );
    expect(result.isAgencyContext).toBe(true);
    expect(result.allowedCredentialIds).toEqual([]);
    expect(result.reason).toBeDefined();
  });

  it("client n'appartenant pas à l'agence propriétaire du cours : fail-closed (jamais un mélange agence/client)", () => {
    const result = resolveAgencyDeployCredentials(
      { userId: 'agency-1', agencyClientId: 'client-1' },
      client({ agencyUserId: 'agency-INTRUS' }),
    );
    expect(result.isAgencyContext).toBe(true);
    expect(result.allowedCredentialIds).toEqual([]);
    expect(result.reason).toMatch(/n’appartient pas/);
  });

  it('les credentials de l’agence elle-même ne sont jamais dans la liste autorisée du client', () => {
    const result = resolveAgencyDeployCredentials(
      { userId: 'agency-1', agencyClientId: 'client-1' },
      client({ platformCredentials: ['cred-client-1'] }),
    );
    expect(result.allowedCredentialIds).not.toContain('cred-agence-jamais-utilise');
    expect(result.allowedCredentialIds).toEqual(['cred-client-1']);
  });
});

describe('isCredentialAllowedForAgencyCourse — dernière barrière avant usage réel du secret', () => {
  it('autorise un credential standard (hors contexte agence)', () => {
    expect(
      isCredentialAllowedForAgencyCourse(
        { userId: 'user-1', agencyClientId: null },
        null,
        'n-importe-quel-id',
      ),
    ).toBe(true);
  });

  it('autorise un credential du client en contexte agence', () => {
    expect(
      isCredentialAllowedForAgencyCourse(
        { userId: 'agency-1', agencyClientId: 'client-1' },
        client(),
        'cred-client-1',
      ),
    ).toBe(true);
  });

  it('refuse un credential qui n’appartient pas au client (ex. compte de l’agence)', () => {
    expect(
      isCredentialAllowedForAgencyCourse(
        { userId: 'agency-1', agencyClientId: 'client-1' },
        client(),
        'cred-agence-1',
      ),
    ).toBe(false);
  });

  it('refuse tout credential si le contexte agence est invalide (client étranger)', () => {
    expect(
      isCredentialAllowedForAgencyCourse(
        { userId: 'agency-1', agencyClientId: 'client-1' },
        client({ agencyUserId: 'agence-INTRUS' }),
        'cred-client-1',
      ),
    ).toBe(false);
  });
});

describe('aggregateAgencyBilling — agrégation des coûts par client', () => {
  it('agrège les coûts par client, jamais mélangés entre eux', () => {
    const rows = [
      { agencyClientId: 'client-1', courseId: 'course-a', estimatedUsd: 1.5 },
      { agencyClientId: 'client-1', courseId: 'course-a', estimatedUsd: 0.5 },
      { agencyClientId: 'client-1', courseId: 'course-b', estimatedUsd: 2 },
      { agencyClientId: 'client-2', courseId: 'course-c', estimatedUsd: 10 },
    ];
    const clients = [
      { id: 'client-1', clientName: 'Client A', clientEmail: 'a@test.fr' },
      { id: 'client-2', clientName: 'Client B', clientEmail: 'b@test.fr' },
    ];
    const reports = aggregateAgencyBilling(rows, clients);

    expect(reports).toHaveLength(2);
    // Trié par coût décroissant : Client B (10$) avant Client A (4$).
    expect(reports[0]?.clientName).toBe('Client B');
    expect(reports[0]?.totalUsd).toBe(10);
    expect(reports[0]?.courseCount).toBe(1);

    const clientA = reports.find((r) => r.agencyClientId === 'client-1');
    expect(clientA?.totalUsd).toBe(4);
    expect(clientA?.courseCount).toBe(2);
    // course-a et course-b sont ex-aequo (2$) — ordre de tri non garanti entre
    // égaux, on vérifie le contenu indépendamment de l'ordre.
    expect(clientA?.byCourse).toEqual(
      expect.arrayContaining([
        { courseId: 'course-b', totalUsd: 2 },
        { courseId: 'course-a', totalUsd: 2 },
      ]),
    );
    expect(clientA?.byCourse).toHaveLength(2);
  });

  it('un client sans aucune ligne de coût n’apparaît pas dans le rapport', () => {
    const reports = aggregateAgencyBilling(
      [{ agencyClientId: 'client-1', courseId: 'course-a', estimatedUsd: 1 }],
      [
        { id: 'client-1', clientName: 'Client A', clientEmail: 'a@test.fr' },
        { id: 'client-2', clientName: 'Client sans coût', clientEmail: 'b@test.fr' },
      ],
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]?.agencyClientId).toBe('client-1');
  });

  it('résiste à un client inconnu dans les lignes (fallback "Client inconnu")', () => {
    const reports = aggregateAgencyBilling(
      [{ agencyClientId: 'client-orphelin', courseId: 'course-a', estimatedUsd: 3 }],
      [],
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]?.clientName).toBe('Client inconnu');
    expect(reports[0]?.totalUsd).toBe(3);
  });

  it('arrondit les totaux à 4 décimales', () => {
    const reports = aggregateAgencyBilling(
      [
        { agencyClientId: 'client-1', courseId: 'course-a', estimatedUsd: 0.00011 },
        { agencyClientId: 'client-1', courseId: 'course-a', estimatedUsd: 0.00022 },
      ],
      [{ id: 'client-1', clientName: 'Client A', clientEmail: 'a@test.fr' }],
    );
    // 0.00011 + 0.00022 = 0.00033 → arrondi à 4 décimales = 0.0003.
    expect(reports[0]?.totalUsd).toBe(0.0003);
  });
});
