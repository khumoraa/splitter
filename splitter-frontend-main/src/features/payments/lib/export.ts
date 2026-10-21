import { Share } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import { statementHtml, statementText, type StatementModel } from './statement';

/** Renders the statement to a PDF in the app cache, opens the system Share sheet, then removes the file. */
export async function sharePdf(model: StatementModel, fileTitle: string): Promise<'shared' | 'text'> {
  if (!(await Sharing.isAvailableAsync())) {
    await Share.share({ message: statementText(model) });
    return 'text';
  }
  const { uri } = await Print.printToFileAsync({ html: statementHtml(model) });
  try {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: fileTitle });
  } finally {
    try { new File(uri).delete(); } catch { /* already gone */ }
  }
  return 'shared';
}

export async function shareText(model: StatementModel): Promise<void> {
  await Share.share({ message: statementText(model) });
}
