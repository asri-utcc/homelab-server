import React, { useEffect } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

let fontsLoaded = false;

export const THAI_FONT_FAMILY = "'Noto Sans Thai', 'Noto Naskh Arabic', sans-serif";
export const THAI_LOOPED_FAMILY = "'Noto Sans Thai', 'Noto Naskh Arabic', sans-serif";
export const ARABIC_FONT_FAMILY = "'Noto Naskh Arabic', serif";
/** Hand-lettered Thai (OFL, Cadson Demak) used by the illustrated doodle styles */
export const THAI_HAND_FAMILY = "'Mali', 'Itim', 'Noto Sans Thai', sans-serif";
export const THAI_MARKER_FAMILY = "'Sriracha', 'Mali', 'Noto Sans Thai', sans-serif";

export const ThaiFontLoader: React.FC = () => {
  useEffect(() => {
    if (fontsLoaded) return;
    const handle = delayRender('Loading local Thai and Arabic fonts');
    const fontDescriptors: Array<[string, string, FontFaceDescriptors]> = [
      ['Noto Sans Thai', staticFile('fonts/NotoSansThai-Regular.ttf'), { weight: '400' }],
      ['Noto Sans Thai', staticFile('fonts/NotoSansThai-Bold.ttf'), { weight: '700' }],
      ['Noto Looped Thai', staticFile('fonts/NotoLoopedThai-Bold.ttf'), { weight: '700' }],
      ['Mali', staticFile('fonts/Mali-SemiBold.ttf'), { weight: '600' }],
      ['Mali', staticFile('fonts/Mali-Bold.ttf'), { weight: '700' }],
      ['Itim', staticFile('fonts/Itim-Regular.ttf'), { weight: '400' }],
      ['Sriracha', staticFile('fonts/Sriracha-Regular.ttf'), { weight: '400' }],
      ['Noto Naskh Arabic', staticFile('fonts/NotoNaskhArabic-Regular.ttf'), { weight: '400' }],
      ['Noto Naskh Arabic', staticFile('fonts/NotoNaskhArabic-Bold.ttf'), { weight: '700' }],
    ];

    Promise.allSettled(
      fontDescriptors.map(([family, url, descriptors]) =>
        new FontFace(family, `url(${url})`, descriptors).load(),
      ),
    )
      .then((results) => {
        results.forEach((res) => {
          if (res.status === 'fulfilled') {
            document.fonts.add(res.value);
          } else {
            console.error('Font load failed:', res.reason);
          }
        });
        fontsLoaded = true;
        continueRender(handle);
      })
      .catch((err) => {
        console.error('Font load failed:', err);
        continueRender(handle);
      });
  }, []);

  return null;
};
