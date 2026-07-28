import { buildRostersCsv, CsvTeam } from './rosters-csv';

const entry = (externalId: number | null, name: string, price: number) => ({
  externalId,
  name,
  realTeam: 'Inter',
  price,
});

describe('buildRostersCsv', () => {
  it('apre ogni blocco-squadra con il separatore e chiude il file con un newline', () => {
    const teams: CsvTeam[] = [
      {
        teamName: 'Squadra #0',
        roster: [entry(2167, 'Orsolini', 150), entry(5585, 'Malen', 350)],
      },
      { teamName: 'Squadra #1', roster: [entry(254, 'Dimarco', 320)] },
    ];

    expect(buildRostersCsv(teams).csv).toBe(
      [
        '$,$,$',
        'Squadra #0,2167,150',
        'Squadra #0,5585,350',
        '$,$,$',
        'Squadra #1,254,320',
        '',
      ].join('\n'),
    );
  });

  it('ordina la rosa per prezzo crescente, come il file d’esempio di Fantacalcio.it', () => {
    const teams: CsvTeam[] = [
      {
        teamName: 'Squadra #3',
        roster: [
          entry(4871, 'Thuram', 270),
          entry(6435, 'Krstovic', 95),
          entry(5687, 'Vlasic', 100),
        ],
      },
    ];

    expect(buildRostersCsv(teams).csv.trim().split('\n')).toEqual([
      '$,$,$',
      'Squadra #3,6435,95',
      'Squadra #3,5687,100',
      'Squadra #3,4871,270',
    ]);
  });

  it('scarta chi non ha un id Fantacalcio.it e lo riporta fra gli esclusi', () => {
    const teams: CsvTeam[] = [
      {
        teamName: 'Squadra #0',
        roster: [entry(null, 'Lautaro Martinez', 200), entry(254, 'Dimarco', 320)],
      },
    ];

    const { csv, skipped } = buildRostersCsv(teams);
    expect(csv.trim().split('\n')).toEqual(['$,$,$', 'Squadra #0,254,320']);
    expect(skipped).toEqual([
      {
        teamName: 'Squadra #0',
        name: 'Lautaro Martinez',
        realTeam: 'Inter',
        price: 200,
      },
    ]);
  });

  it('ripulisce dal nome squadra virgole e virgolette, che sfaserebbero le colonne', () => {
    const teams: CsvTeam[] = [
      {
        teamName: 'Real, "Sporting"  Pippo',
        roster: [entry(254, 'Dimarco', 320)],
      },
    ];

    expect(buildRostersCsv(teams).csv.trim().split('\n')[1]).toBe('Real Sporting Pippo,254,320');
  });

  it('emette il separatore anche per una squadra a rosa vuota: il file resta 1:1 con la lega', () => {
    const teams: CsvTeam[] = [
      { teamName: 'Squadra #0', roster: [] },
      { teamName: 'Squadra #1', roster: [entry(254, 'Dimarco', 320)] },
    ];

    expect(buildRostersCsv(teams).csv.trim().split('\n')).toEqual([
      '$,$,$',
      '$,$,$',
      'Squadra #1,254,320',
    ]);
  });

  it('senza partecipanti non produce un file di soli separatori', () => {
    expect(buildRostersCsv([])).toEqual({ csv: '', skipped: [] });
  });
});
