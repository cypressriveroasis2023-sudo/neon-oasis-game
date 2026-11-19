// Synthetic census shaped like a camera-status unit file.
// 323 In shop, 56 Shop DO NOT USE, 1 exception, and a separate field set
// whose totals must stay the same after those rows are added.
// No customer site names, addresses, or network identifiers.

const fieldCount = 12;
const shopByMhelp = 200;
const shopByTestProject = 123;
const doNotUseCount = 56;

const record = (unit, over) => ({
  unit,
  placement: 'FIELD',
  state: 'RED',
  site: 'Fixture Yard',
  mhelpPlacement: null,
  doNotUse: false,
  watchful: {projectKey: null, projectName: 'Fixture Yard', archived: false, armed: false, immix: false},
  ...over,
});

export function shopCameraCensusFixture(testProjectKeys) {
  const keys = [...testProjectKeys];
  if (!keys.length) throw new Error('The census fixture needs the configured test-project keys.');
  const field = Array.from({length: fieldCount}, (_, index) => record('FIXTURE FIELD ' + (index + 1), {
    state: index % 2 === 0 ? 'RED' : 'GREEN',
    mhelpPlacement: 'FIELD',
    watchful: {projectKey: 'customer-project-' + (index + 1), projectName: 'Fixture customer ' + (index + 1), archived: false, armed: true, immix: index % 3 === 0},
  }));
  const inShop = [
    ...Array.from({length: shopByMhelp}, (_, index) => record('FIXTURE SHOP ' + (index + 1), {
      state: 'UNKNOWN',
      mhelpPlacement: 'SHOP',
      watchful: {projectKey: 'customer-shop-' + (index + 1), projectName: 'Fixture shop ' + (index + 1), archived: false, armed: true, immix: true},
    })),
    ...Array.from({length: shopByTestProject}, (_, index) => record('FIXTURE TEST ' + (index + 1), {
      state: 'RED',
      mhelpPlacement: null,
      watchful: {projectKey: keys[index % keys.length], projectName: 'Fixture test project ' + (index + 1), archived: false, armed: true, immix: true},
    })),
  ];
  const doNotUse = Array.from({length: doNotUseCount}, (_, index) => record('FIXTURE DO NOT USE ' + (index + 1), {
    state: 'GREEN',
    mhelpPlacement: 'SHOP',
    doNotUse: true,
    watchful: {projectKey: keys[index % keys.length], projectName: 'Fixture do not use ' + (index + 1), archived: false, armed: true, immix: true},
  }));
  const exception = [record('FIXTURE EXCEPTION 1', {
    state: 'RED',
    mhelpPlacement: 'FIELD',
    doNotUse: true,
    watchful: {projectKey: keys[0], projectName: 'Fixture exception', archived: false, armed: true, immix: true},
  })];
  return {
    contract: 'COS_SHOP_CAMERA_CENSUS_FIXTURE_V1',
    expected: {inShop: shopByMhelp + shopByTestProject, doNotUse: doNotUseCount, exceptions: 1},
    field,
    units: [...field, ...inShop, ...doNotUse, ...exception],
  };
}
