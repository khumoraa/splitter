import * as Localization from 'expo-localization';
import { resolveLanguage, type LanguageCode } from './languages';

/** The phone's language if the app supports it, otherwise English. Used as the first-launch default. */
export const DEVICE_LANGUAGE: LanguageCode = resolveLanguage(Localization.getLocales()[0]?.languageCode);
