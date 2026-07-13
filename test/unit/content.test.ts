import { describe, expect, it } from 'vitest';
import { parseContent } from '../../src/content/parse.js';

describe('parseContent', () => {
  it('splits GS1 element strings by application identifier when hinted', () => {
    // GTIN (fixed 14) + expiry (fixed 6) + lot (variable, trailing).
    expect(parseContent('01040123456789031719123110ABC123', { gs1: true })).toEqual({
      type: 'gs1',
      raw: '01040123456789031719123110ABC123',
      elements: [
        { ai: '01', value: '04012345678903' },
        { ai: '17', value: '191231' },
        { ai: '10', value: 'ABC123' },
      ],
    });
  });

  it('handles GS-terminated variable fields and 4-digit metric AIs', () => {
    expect(parseContent('10LOT1\x1d21SERIAL9\x1d3103001500', { gs1: true })).toEqual({
      type: 'gs1',
      raw: '10LOT1\x1d21SERIAL9\x1d3103001500',
      elements: [
        { ai: '10', value: 'LOT1' },
        { ai: '21', value: 'SERIAL9' },
        { ai: '3103', value: '001500' },
      ],
    });
  });

  it('falls back to text when the GS1 hint does not parse', () => {
    expect(parseContent('HELLO WORLD', { gs1: true })).toEqual({
      type: 'text',
      text: 'HELLO WORLD',
    });
  });

  it('does not classify digit strings as GS1 without the hint', () => {
    expect(parseContent('010401234567890317191231')).toEqual({
      type: 'text',
      text: '010401234567890317191231',
    });
  });

  it('classifies URLs', () => {
    expect(parseContent('https://example.com/a?b=1#c')).toEqual({
      type: 'url',
      url: 'https://example.com/a?b=1#c',
    });
    expect(parseContent('HTTP://EXAMPLE.COM')).toEqual({ type: 'url', url: 'HTTP://EXAMPLE.COM' });
  });

  it('parses WiFi credentials', () => {
    expect(parseContent('WIFI:T:WPA;S:my network;P:s3cret!;;')).toEqual({
      type: 'wifi',
      ssid: 'my network',
      security: 'WPA',
      password: 's3cret!',
    });
  });

  it('handles WiFi escaping and hidden networks', () => {
    expect(parseContent('WIFI:S:semi\\;colon\\:net;T:WEP;P:pa\\\\ss;H:true;;')).toEqual({
      type: 'wifi',
      ssid: 'semi;colon:net',
      security: 'WEP',
      password: 'pa\\ss',
      hidden: true,
    });
  });

  it('parses open WiFi networks without leaking a password field', () => {
    expect(parseContent('WIFI:S:cafe;T:nopass;;')).toEqual({
      type: 'wifi',
      ssid: 'cafe',
      security: 'nopass',
    });
  });

  it('parses geo URIs', () => {
    expect(parseContent('geo:52.5163,13.3777')).toEqual({
      type: 'geo',
      latitude: 52.5163,
      longitude: 13.3777,
    });
    expect(parseContent('geo:-33.86,151.21,58')).toEqual({
      type: 'geo',
      latitude: -33.86,
      longitude: 151.21,
      altitude: 58,
    });
  });

  it('parses tel and sms', () => {
    expect(parseContent('tel:+1-555-0100')).toEqual({ type: 'tel', number: '+1-555-0100' });
    expect(parseContent('SMSTO:+15550100:See you at 5')).toEqual({
      type: 'sms',
      number: '+15550100',
      message: 'See you at 5',
    });
    expect(parseContent('sms:+15550100?body=hi%20there')).toEqual({
      type: 'sms',
      number: '+15550100',
      message: 'hi there',
    });
  });

  it('parses mailto and MATMSG email payloads', () => {
    expect(parseContent('mailto:a@b.com?subject=Hi&body=Hello')).toEqual({
      type: 'email',
      to: 'a@b.com',
      subject: 'Hi',
      body: 'Hello',
    });
    expect(parseContent('MATMSG:TO:a@b.com;SUB:Hi;BODY:Hello;;')).toEqual({
      type: 'email',
      to: 'a@b.com',
      subject: 'Hi',
      body: 'Hello',
    });
  });

  it('parses vCards', () => {
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Ada Lovelace',
      'ORG:Analytical Engines',
      'TEL;TYPE=CELL:+15550100',
      'EMAIL:ada@example.com',
      'END:VCARD',
    ].join('\r\n');
    expect(parseContent(vcard)).toEqual({
      type: 'vcard',
      raw: vcard,
      name: 'Ada Lovelace',
      org: 'Analytical Engines',
      tel: '+15550100',
      email: 'ada@example.com',
    });
  });

  it('falls back to text for everything else', () => {
    expect(parseContent('just some words')).toEqual({ type: 'text', text: 'just some words' });
    expect(parseContent('WIFI:ט')).toEqual({ type: 'text', text: 'WIFI:ט' });
    expect(parseContent('')).toEqual({ type: 'text', text: '' });
  });
});
