// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@shared/constants';
import type { DownloadError, HistoryEntry } from '@shared/types';
import { App } from '@renderer/App';
import { ErrorBanner } from '@renderer/components/ErrorBanner';
import { HistoryList } from '@renderer/components/HistoryList';
import { JobCard } from '@renderer/components/JobCard';
import { QueueList } from '@renderer/components/QueueList';
import { Toast } from '@renderer/components/Toast';
import { UpdateBanner } from '@renderer/components/UpdateBanner';
import { UrlInput } from '@renderer/components/UrlInput';
import { resolveAppLanguage, systemLocale } from '@renderer/i18n/language';
import { useAppLanguage, useTranslator } from '@renderer/i18n/useTranslator';
import { INITIAL_APP_UPDATE, useAppStore } from '@renderer/store/appStore';
import { useProgramsStore } from '@renderer/store/programsStore';
import { APP_UPDATE_IDLE, installMockApi, makeJob, type MockApiHandle } from '../helpers/mockApi';

let mock: MockApiHandle;
const initial = useAppStore.getState();

function useLanguage(language: 'device' | 'en' | 'pt' | 'es' | 'zh' | 'ja'): void {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, language } });
}

beforeEach(() => {
    mock = installMockApi();
    useAppStore.setState({
        ...initial,
        tab: 'downloads',
        jobs: [],
        history: [],
        settings: DEFAULT_SETTINGS,
        binaries: null,
        notice: null,
       
        appUpdate: INITIAL_APP_UPDATE
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.lang = '';
});

describe('systemLocale and resolveAppLanguage', () => {
    it('reads the language of the browser', () => {
        vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('pt-BR');
        expect(systemLocale()).toBe('pt-BR');
        expect(resolveAppLanguage('device')).toBe('pt');
    });

    it('prefers an explicit language over the browser', () => {
        vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('pt-BR');
        expect(resolveAppLanguage('ja')).toBe('ja');
    });

    it('falls back to English when the browser language is not supported', () => {
        vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('fr-FR');
        expect(resolveAppLanguage('device')).toBe('en');
    });
});

describe('useAppLanguage and useTranslator', () => {
    it('follow the language saved in the settings', () => {
        useLanguage('es');
        const { result } = renderHook(() => {
            return { language: useAppLanguage(), t: useTranslator() };
        });
        expect(result.current.language).toBe('es');
        expect(result.current.t('downloads.nav.history')).toBe('HISTORIAL');
    });

    it('follow the browser language for "device"', () => {
        vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('zh-CN');
        const { result } = renderHook(() => {
            return { language: useAppLanguage(), t: useTranslator() };
        });
        expect(result.current.language).toBe('zh');
        expect(result.current.t('downloads.nav.history')).toBe('历史');
    });

    it('update when the language changes', () => {
        useLanguage('en');
        const { result } = renderHook(() => {
            return useTranslator();
        });
        expect(result.current('tab.settings')).toBe('SETTINGS (GLOBAL)');
        act(() => {
            useLanguage('ja');
        });
        expect(result.current('tab.settings')).toBe('設定（全体）');
    });
});

describe('App in another language', () => {
    it.each([
        ['en', 'VIDEO DOWNLOADER', 'HISTORY', 'SETTINGS (GLOBAL)', 'Sections', 'TARGET LINKS'],
        ['pt', 'BAIXADOR DE VÍDEOS', 'HISTÓRICO', 'CONFIGURAÇÕES (GLOBAIS)', 'Seções', 'LINKS DE DESTINO'],
        ['es', 'DESCARGADOR DE VÍDEOS', 'HISTORIAL', 'AJUSTES (GLOBALES)', 'Secciones', 'ENLACES DE DESTINO'],
        ['zh', '视频下载器', '历史', '设置（全局）', '栏目', '目标链接'],
        ['ja', '動画ダウンローダー', '履歴', '設定（全体）', 'セクション', '対象リンク']
    ] as const)('shows the tabs in "%s" and sets the document language', async (language, downloads, history, settings, sections, targetLinks) => {
        useLanguage(language);
        mock.api.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, language });
        render(<App />);
        expect(screen.getByRole('navigation', { name: sections })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: downloads })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: settings })).toBeInTheDocument();
        expect(document.documentElement.lang).toBe(language);
        expect(await screen.findByText(targetLinks)).toBeInTheDocument();
        // The history is a screen of the video downloader, not a tab of its own.
        expect(within(screen.getByRole('navigation', { name: sections })).queryByRole('button', { name: history })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: history })).toBeInTheDocument();
    });

    it('shows the boot message in the saved language', () => {
        useLanguage('pt');
        render(<App />);
        expect(screen.getByText('// INICIANDO SISTEMAS…')).toBeInTheDocument();
    });

    it('switches the whole interface when the language setting changes', async () => {
        const user = userEvent.setup();
        render(<App />);
        await screen.findByLabelText('Link 1');
        await user.click(screen.getByRole('button', { name: 'SETTINGS (GLOBAL)' }));
        await user.selectOptions(screen.getByLabelText('Language'), 'es');
        await waitFor(() => {
            expect(mock.api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, language: 'es' });
        });
        expect(await screen.findByRole('button', { name: 'DESCARGADOR DE VÍDEOS' })).toBeInTheDocument();
        expect(screen.getByLabelText('Idioma')).toHaveValue('es');
        expect(document.documentElement.lang).toBe('es');
    });

    it('follows the browser language when the setting is "device"', async () => {
        vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('ja-JP');
        render(<App />);
        expect(screen.getByRole('button', { name: '動画ダウンローダー' })).toBeInTheDocument();
        expect(document.documentElement.lang).toBe('ja');
    });
});

describe('components in another language', () => {
    it('translates the job card status, progress, ETA and actions', () => {
        useLanguage('pt');
        const handlers = { onCancel: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onRetry: vi.fn(), onRemove: vi.fn(), onClearPartials: vi.fn(), onShowFile: vi.fn() };
        render(<JobCard job={makeJob()} {...handlers} />);
        expect(screen.getByText('BAIXANDO')).toBeInTheDocument();
        expect(screen.getByText('Restam 00:10')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Progresso do download' })).toHaveAttribute('aria-valuenow', '43');
        expect(screen.getByRole('button', { name: 'CANCELAR' })).toBeInTheDocument();
    });

    it('translates a live recording', () => {
        useLanguage('es');
        const handlers = { onCancel: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onRetry: vi.fn(), onRemove: vi.fn(), onClearPartials: vi.fn(), onShowFile: vi.fn() };
        render(<JobCard job={makeJob({ live: true, elapsedSeconds: 65, downloadedBytes: 2048 })} {...handlers} />);
        expect(screen.getByText('GRABANDO')).toBeInTheDocument();
        expect(screen.getByText('● EN DIRECTO')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Grabando una transmisión en directo' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DETENER Y GUARDAR' })).toBeInTheDocument();
    });

    it('translates the finished job actions and asks the live deletion confirmation in the saved language', async () => {
        useLanguage('zh');
        const user = userEvent.setup();
        const handlers = { onCancel: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onRetry: vi.fn(), onRemove: vi.fn(), onClearPartials: vi.fn(), onShowFile: vi.fn() };
        render(<JobCard job={makeJob({ status: 'cancelled', live: true, hasPartial: true })} {...handlers} />);
        expect(screen.getByText('已取消')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '移除' }));
        const dialog = screen.getByRole('dialog', { name: '要从列表中移除此下载吗？' });
        expect(within(dialog).getByText('这段直播录制尚未保存，删除后无法恢复。要删除吗？')).toBeInTheDocument();
        expect(handlers.onRemove).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole('button', { name: '移除' }));
        expect(handlers.onRemove).toHaveBeenCalledWith('job-1');
        expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '清除未完成的文件' })).toBeInTheDocument();
    });

    it.each([
        ['en', 'PROCESSING', 'Processing the downloaded file', 'Converting the audio', 'Joining video and audio'],
        ['pt', 'PROCESSANDO', 'Processando o arquivo baixado', 'Convertendo o áudio', 'Juntando vídeo e áudio'],
        ['es', 'PROCESANDO', 'Procesando el archivo descargado', 'Convirtiendo el audio', 'Uniendo vídeo y audio'],
        ['zh', '处理中', '正在处理已下载的文件', '正在转换音频', '正在合并视频和音频'],
        ['ja', '処理中', 'ダウンロードしたファイルを処理しています', '音声を変換しています', '映像と音声を結合しています']
    ] as const)('translates the processing of the downloaded file in "%s"', (language, badge, label, audio, merge) => {
        useLanguage(language);
        const handlers = { onCancel: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onRetry: vi.fn(), onRemove: vi.fn(), onClearPartials: vi.fn(), onShowFile: vi.fn() };
        const { rerender } = render(<JobCard job={makeJob({ postProcess: 'ExtractAudio' })} {...handlers} />);
        expect(screen.getByText(badge)).toBeInTheDocument();
        expect(screen.getByText(audio)).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: label })).toBeInTheDocument();
        rerender(<JobCard job={makeJob({ postProcess: 'Merger' })} {...handlers} />);
        expect(screen.getByText(merge)).toBeInTheDocument();
    });

    it.each([
        ['en', 'SAVING FILE', 'Closing the recording and saving the file', 'Saving the recording. Do not close the app'],
        ['pt', 'SALVANDO ARQUIVO', 'Encerrando a gravação e salvando o arquivo', 'Salvando a gravação. Não feche o aplicativo'],
        ['es', 'GUARDANDO ARCHIVO', 'Cerrando la grabación y guardando el archivo', 'Guardando la grabación. No cierres la aplicación'],
        ['zh', '正在保存文件', '正在结束录制并保存文件', '正在保存录制内容，请勿关闭应用'],
        ['ja', 'ファイル保存中', '録画を終了してファイルを保存しています', '録画を保存しています。アプリを閉じないでください']
    ] as const)('translates the saving of a stopped recording in "%s"', (language, badge, label, text) => {
        useLanguage(language);
        const handlers = { onCancel: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onRetry: vi.fn(), onRemove: vi.fn(), onClearPartials: vi.fn(), onShowFile: vi.fn() };
        render(<JobCard job={makeJob({ live: true, saving: true })} {...handlers} />);
        expect(screen.getByText(badge)).toBeInTheDocument();
        expect(screen.getByText(text)).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: label })).toBeInTheDocument();
    });

    it.each([
        ['en', 'JOINING PARTS', 'Joining the parts of the recording into one file'],
        ['pt', 'JUNTANDO PARTES', 'Juntando as partes da gravação em um único arquivo'],
        ['es', 'UNIENDO PARTES', 'Uniendo las partes de la grabación en un solo archivo'],
        ['zh', '合并分段', '正在将录制的各个分段合并为一个文件'],
        ['ja', 'パート結合中', '録画のパートを1つのファイルに結合しています']
    ] as const)('translates the joining of the parts of a recording in "%s"', (language, badge, text) => {
        useLanguage(language);
        const handlers = { onCancel: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onRetry: vi.fn(), onRemove: vi.fn(), onClearPartials: vi.fn(), onShowFile: vi.fn() };
        render(<JobCard job={makeJob({ live: true, merging: true })} {...handlers} />);
        expect(screen.getByText(badge)).toBeInTheDocument();
        expect(screen.getByText(text)).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: text })).toBeInTheDocument();
    });

    it.each([
        ['en', 'VERIFYING END', 'The stream stopped. Checking whether it really ended… 6s', 'FINISH NOW', 'WAITING FOR LIVE', 'Waiting for the live stream to start'],
        ['pt', 'VERIFICANDO FIM', 'A transmissão parou. Verificando se realmente terminou… 6s', 'FINALIZAR AGORA', 'AGUARDANDO A LIVE', 'Aguardando a transmissão ao vivo começar'],
        ['es', 'VERIFICANDO FIN', 'La transmisión se detuvo. Comprobando si realmente terminó… 6s', 'FINALIZAR AHORA', 'ESPERANDO EL DIRECTO', 'Esperando a que empiece la transmisión en directo'],
        ['zh', '确认结束中', '直播已中断。正在确认是否真的结束… 6 秒', '立即结束', '等待直播', '正在等待直播开始'],
        ['ja', '終了を確認中', '配信が止まりました。本当に終了したか確認中… 6 秒', '今すぐ終了', 'ライブ待機中', 'ライブ配信の開始を待っています']
    ] as const)('translates the live phases of a card in "%s"', (language, verifyingBadge, verifyingText, finishNow, waitingBadge, waitingText) => {
        useLanguage(language);
        const handlers = { onCancel: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onRetry: vi.fn(), onRemove: vi.fn(), onClearPartials: vi.fn(), onShowFile: vi.fn() };
        const { unmount } = render(<JobCard job={makeJob({ live: true, endCheck: { secondsLeft: 6, totalSeconds: 10 } })} {...handlers} />);
        expect(screen.getByText(verifyingBadge)).toBeInTheDocument();
        expect(screen.getByText(verifyingText)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: finishNow })).toBeInTheDocument();
        unmount();
        render(<JobCard job={makeJob({ waitingForLive: true })} {...handlers} />);
        expect(screen.getByText(waitingBadge)).toBeInTheDocument();
        expect(screen.getByText(waitingText)).toBeInTheDocument();
    });

    it.each([
        ['en', 'OPTIONS', 'Options for link 1', 'CUSTOM', 'APPLY'],
        ['pt', 'OPÇÕES', 'Opções do link 1', 'PERSONALIZADO', 'APLICAR'],
        ['es', 'OPCIONES', 'Opciones del enlace 1', 'PERSONALIZADA', 'APLICAR'],
        ['zh', '选项', '链接 1 的选项', '自定义', '应用'],
        ['ja', 'オプション', 'リンク 1 のオプション', 'カスタム', '適用']
    ] as const)('translates the options of one download in "%s"', async (language, button, ariaLabel, badge, applyLabel) => {
        useLanguage(language);
        const user = userEvent.setup();
        const handlers = { onCancel: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onRetry: vi.fn(), onRemove: vi.fn(), onClearPartials: vi.fn(), onShowFile: vi.fn() };
        const { unmount } = render(<UrlInput />);
        const opener = screen.getByRole('button', { name: ariaLabel });
        expect(opener).toHaveTextContent(button);
        await user.click(opener);
        expect(screen.getByRole('dialog', { name: ariaLabel })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: applyLabel })).toBeInTheDocument();
        unmount();
        render(<JobCard job={makeJob({ customized: true })} {...handlers} />);
        expect(screen.getByText(badge)).toBeInTheDocument();
    });

    it('translates the error banner and its buttons', async () => {
        useLanguage('ja');
        const user = userEvent.setup();
        const error: DownloadError = { code: 'NETWORK', title: 'ネットワークエラー', hint: '接続を確認して、もう一度お試しください。', raw: 'raw output' };
        render(<ErrorBanner error={error} onRetry={vi.fn()} />);
        expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'ストリームを探す' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: '詳細を表示' }));
        expect(screen.getByText('raw output')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '詳細を隠す' })).toBeInTheDocument();
    });

    it('translates the queue label, the empty state and the clear button', () => {
        useLanguage('es');
        const { unmount } = render(<QueueList />);
        expect(screen.getByText('// NO HAY DESCARGAS ACTIVAS. PEGA UNA URL ARRIBA.')).toBeInTheDocument();
        unmount();
        useAppStore.setState({ jobs: [makeJob({ id: 'a', status: 'done' }), makeJob({ id: 'b' })] });
        render(<QueueList />);
        expect(screen.getByRole('region', { name: 'Cola de descargas' })).toBeInTheDocument();
        expect(screen.getByText('COLA [2]')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'BORRAR FINALIZADAS' })).toBeInTheDocument();
    });

    it('translates the history and formats its dates for the language', () => {
        useLanguage('pt');
        const done: HistoryEntry = { id: 'h1', url: 'https://x.com/1', title: 'Done', filePath: '/d/Done.mp4', status: 'done', errorTitle: null, finishedAt: 1700000000000 };
        const failed: HistoryEntry = { id: 'h2', url: 'https://x.com/2', title: 'Failed', filePath: null, status: 'error', errorTitle: 'Falha de rede', finishedAt: 1700000001000 };
        const unknown: HistoryEntry = { ...failed, id: 'h3', errorTitle: null };
        useAppStore.setState({ history: [done, failed, unknown] });
        render(<HistoryList />);
        expect(screen.getByText('HISTÓRICO [3]')).toBeInTheDocument();
        expect(screen.getByText(`CONCLUÍDO · ${new Date(done.finishedAt).toLocaleString('pt')}`)).toBeInTheDocument();
        expect(screen.getByText(`FALHOU — Falha de rede · ${new Date(failed.finishedAt).toLocaleString('pt')}`)).toBeInTheDocument();
        expect(screen.getByText(/^FALHOU — Erro desconhecido ·/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'LIMPAR HISTÓRICO' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'MOSTRAR ARQUIVO' })).toBeInTheDocument();
    });

    it('translates the empty history', () => {
        useLanguage('ja');
        render(<HistoryList />);
        expect(screen.getByText('// 履歴は空です。')).toBeInTheDocument();
    });

    it('translates the link input, its row buttons and its validation messages', async () => {
        useLanguage('pt');
        const user = userEvent.setup();
        mock.api.chooseDirectory.mockResolvedValue('/media');
        render(<UrlInput />);
        expect(screen.getByText('LINKS DE DESTINO')).toBeInTheDocument();
        expect(screen.getByLabelText('Link 1')).toBeInTheDocument();
        expect(screen.getByLabelText('SOMENTE ÁUDIO')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'BAIXAR' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Cole pelo menos uma URL de vídeo.');
        await user.click(screen.getByRole('button', { name: '+ ADICIONAR LINK' }));
        expect(screen.getByLabelText('Link 2')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Remover o link 2' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Escolher pasta para o link 1' }));
        expect(await screen.findByText('Salvando em: /media')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Usar a pasta padrão para o link 1' })).toBeInTheDocument();
    });

    it('translates the generic add failure when the main process gives no message', async () => {
        useLanguage('es');
        const user = userEvent.setup();
        mock.api.addDownload.mockResolvedValueOnce({ ok: false, job: null, message: null });
        render(<UrlInput />);
        await user.type(screen.getByLabelText('Enlace 1'), 'https://example.com/v');
        await user.click(screen.getByRole('button', { name: 'DESCARGAR' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo añadir la descarga.');
    });

    it('translates the toast dismiss button', () => {
        useLanguage('zh');
        useAppStore.setState({ notice: { kind: 'info', message: 'ok' } });
        render(<Toast />);
        expect(screen.getByRole('button', { name: '关闭通知' })).toBeInTheDocument();
    });

    it('translates the update banner and its actions', () => {
        useLanguage('pt');
        useAppStore.setState({ appUpdate: { ...APP_UPDATE_IDLE, status: 'available', version: '0.5.0' } });
        const { unmount } = render(<UpdateBanner />);
        expect(screen.getByText('A versão 0.5.0 está disponível.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'ATUALIZAR PARA 0.5.0' })).toBeInTheDocument();
        unmount();
        useAppStore.setState({ appUpdate: { ...APP_UPDATE_IDLE, status: 'downloaded', version: '0.5.0' } });
        render(<UpdateBanner />);
        expect(screen.getByText('A versão 0.5.0 está pronta para instalar.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'REINICIAR E INSTALAR' })).toBeInTheDocument();
    });
});

describe('store messages in another language', () => {
    it('uses the saved language for the toast of a program that could not be downloaded', async () => {
        useLanguage('pt');
        useAppStore.setState({ toasts: [] });
        const stop = await useProgramsStore.getState().init();
        mock.emitProgramTool({ id: 'ytdlp', status: 'error', version: null, bytesDone: 0, bytesTotal: 0, percent: 0, error: { code: 'DOWNLOAD_FAILED', message: 'offline' } });
        expect(useAppStore.getState().toasts.map((toast) => {
            return toast.message;
        })).toEqual(['Não foi possível baixar o yt-dlp. Abra as configurações da seção para tentar de novo.']);
        stop();
    });
});
