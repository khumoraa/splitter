import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ja from './locales/ja.json';
import uz from './locales/uz.json';
import { DEFAULT_LANGUAGE } from './languages';
import { DEVICE_LANGUAGE } from './device-language';

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
    uz: { translation: uz },
  },
  lng: DEVICE_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false },
});

export default i18n;
