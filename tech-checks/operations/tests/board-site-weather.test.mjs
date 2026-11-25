// The board must never wait on weather and must never break because of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {hasSite, siteKey, weatherWords, roughDay, loadSiteWeather, peekSiteWeather, resetSiteWeather, WEATHER_DAYS}
  from '../src/cosBoard/boardWeather.ts';

const body = {
  current:{temperature_2m:71.4, weather_code:3, wind_speed_10m:9.2},
  daily:{
    time:['2026-11-25','2026-11-26','2026-11-27'],
    temperature_2m_max:[72,65,58], temperature_2m_min:[54,49,41],
    weather_code:[3,61,95], precipitation_probability_max:[10,80,90],
  },
};
const ok = () => Promise.resolve({ok:true, json:async()=>body});

test('a shop unit never asks for weather', () => {
  for(const [lat,lng] of [[0,0],[0,-95.3],[29.7,0],[null,null],['29.7','-95.3'],[NaN,1],[91,10],[10,181]])
    assert.equal(hasSite(lat,lng), false, String(lat)+','+String(lng));
  assert.equal(hasSite(29.7604,-95.3698), true);
  let called = 0;
  assert.equal(loadSiteWeather(0, 0, () => { called++; return ok(); }), null);
  assert.equal(called, 0, 'no request may be made for a unit with no site');
});

test('units on one yard share a single read', async () => {
  resetSiteWeather();
  let calls = 0;
  const counting = () => { calls++; return ok(); };
  // ~1km apart: the same yard.
  await loadSiteWeather(29.7604, -95.3698, counting);
  const second = loadSiteWeather(29.7601, -95.3702, counting);
  if(second) await second;
  assert.equal(calls, 1);
  assert.equal(siteKey(29.7604,-95.3698), siteKey(29.7601,-95.3702));
});

test('a readable forecast is parsed into days', async () => {
  resetSiteWeather();
  await loadSiteWeather(29.7604, -95.3698, ok);
  const {value, error, loading} = peekSiteWeather(29.7604, -95.3698);
  assert.equal(error, null);
  assert.equal(loading, false);
  assert.equal(value.nowF, 71.4);
  assert.equal(value.windMph, 9.2);
  assert.equal(value.days.length, 3);
  assert.deepEqual(value.days[1], {date:'2026-11-26', hi:65, lo:49, code:61, rain:80});
});

test('a failed read never throws and never leaves the card waiting', async () => {
  for(const bad of [
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve({ok:false, json:async()=>({})}),
    () => Promise.resolve({ok:true, json:async()=>{ throw new Error('not json'); }}),
    () => Promise.resolve({ok:true, json:async()=>({})}),          // empty answer
  ]){
    resetSiteWeather();
    await assert.doesNotReject(loadSiteWeather(29.7604, -95.3698, bad));
    const {value, error, loading} = peekSiteWeather(29.7604, -95.3698);
    assert.equal(value, null);
    assert.equal(loading, false);
    assert.match(error, /could not be read|not available/);
  }
});

test('conditions read as a person would say them', () => {
  assert.equal(weatherWords(0), 'Clear');
  assert.equal(weatherWords(95), 'Thunderstorms');
  assert.equal(weatherWords(null), '');
  assert.equal(weatherWords(7), 'Unsettled');     // unknown code is never blank
});

test('a rough day is called out, a damp one is not', () => {
  assert.equal(roughDay(95, 10), true);           // thunderstorms
  assert.equal(roughDay(65, 0), true);            // heavy rain
  assert.equal(roughDay(3, 80), true);            // cloudy but very likely wet
  assert.equal(roughDay(3, 40), false);
  assert.equal(roughDay(61, 20), false);          // light rain is a working day
  assert.equal(roughDay(null, null), false);
});

test('the forecast covers this week and next', () => {
  assert.ok(WEATHER_DAYS >= 14, 'James asked for this week and the next');
});
