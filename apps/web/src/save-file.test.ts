import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachmentName, saveFile, type SaveEnvironment } from './save-file.ts';

const request = {
  url: '/api/v1/translations/example/final',
  suggestedName: 'ABC-10003 – Arquivo.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  extension: '.docx',
};
test('escolhe a pasta antes da rede e só confirma salvamento após fechar a escrita', async () => {
  const events: string[] = [];
  const chunks: Uint8Array[] = [];
  let resolvePicker!: (value: { name: string; createWritable: () => Promise<WritableStream<Uint8Array>> }) => void;
  const operation = saveFile(request, {
    pickFile: (options) => {
      events.push('picker');
      assert.equal(options.suggestedName, request.suggestedName);
      return new Promise((resolve) => {
        resolvePicker = resolve;
      });
    },
    fetchFile: async () => {
      events.push('fetch');
      return new Response('Word sintético');
    },
    downloadBlob: () => assert.fail('O salvamento nativo não deve criar download duplicado'),
  });
  assert.deepEqual(events, ['picker']);
  resolvePicker({
    name: 'Meu nome.docx',
    createWritable: async () =>
      new WritableStream({
        write: (chunk) => {
          chunks.push(chunk);
          events.push('write');
        },
        close: () => {
          events.push('close');
        },
      }),
  });
  assert.deepEqual(await operation, { status: 'saved', name: 'Meu nome.docx' });
  assert.deepEqual(events, ['picker', 'fetch', 'write', 'close']);
  assert.equal(new TextDecoder().decode(chunks[0]), 'Word sintético');
});
test('cancelar o diálogo não chama o servidor nem grava download', async () => {
  assert.deepEqual(
    await saveFile(request, {
      pickFile: async () => {
        throw new DOMException('Cancelado', 'AbortError');
      },
      fetchFile: async () => assert.fail('Não deve solicitar documento cancelado'),
      downloadBlob: () => assert.fail(),
    }),
    { status: 'cancelled' },
  );
});
test('erro HTTP preserva o arquivo escolhido e apresenta a mensagem do servidor', async () => {
  await assert.rejects(
    saveFile(request, {
      pickFile: async () => ({
        name: 'arquivo.docx',
        createWritable: async () => assert.fail('Não deve abrir escrita em resposta de erro'),
      }),
      fetchFile: async () => new Response(JSON.stringify({ error: { message: 'O documento foi alterado' } }), { status: 409 }),
      downloadBlob: () => assert.fail(),
    }),
    /O documento foi alterado/,
  );
});
test('falha de leitura aborta a escrita sem anunciar salvamento concluído', async () => {
  let aborted = false;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.error(new Error('Rede interrompida'));
    },
  });
  await assert.rejects(
    saveFile(request, {
      pickFile: async () => ({
        name: 'arquivo.docx',
        createWritable: async () =>
          new WritableStream({
            abort: () => {
              aborted = true;
            },
            close: () => {
              closed = true;
            },
          }),
      }),
      fetchFile: async () => new Response(body),
      downloadBlob: () => assert.fail(),
    }),
    /Rede interrompida/,
  );
  assert.equal(aborted, true);
  assert.equal(closed, false);
});
test('navegador sem seletor baixa uma vez, usando nome UTF-8 entregue pela API', async () => {
  let downloads = 0;
  const environment: SaveEnvironment = {
    fetchFile: async (_url, init) => {
      assert.equal(init.credentials, 'same-origin');
      return new Response('ZIP', {
        headers: { 'content-disposition': "attachment; filename*=UTF-8''ABC-10003%20%E2%80%93%20Arquivo%20(01).zip" },
      });
    },
    downloadBlob: (blob, name) => {
      downloads++;
      assert.equal(blob.size, 3);
      assert.equal(name, 'ABC-10003 – Arquivo (01).zip');
    },
  };
  assert.deepEqual(await saveFile({ ...request, extension: '.zip', mimeType: 'application/zip' }, environment), {
    status: 'downloaded',
    name: 'ABC-10003 – Arquivo (01).zip',
  });
  assert.equal(downloads, 1);
});
test('ZIP mantém POST autenticado, CSRF e seleção após escolher local', async () => {
  const body = JSON.stringify({ translationIds: ['a', 'b'], format: 'pdf' });
  await saveFile(
    { ...request, init: { method: 'POST', headers: { 'X-CSRF-Protection': '1' }, body } },
    {
      fetchFile: async (_url, init) => {
        assert.equal(init.method, 'POST');
        assert.equal(init.credentials, 'same-origin');
        assert.equal((init.headers as Record<string, string>)['X-CSRF-Protection'], '1');
        assert.equal(init.body, body);
        return new Response('ZIP');
      },
      downloadBlob: () => undefined,
    },
  );
});
test('nome malformado não impede download e separadores não viram caminhos locais', () => {
  assert.equal(attachmentName("attachment; filename*=UTF-8''%ZZ", 'Arquivo.zip'), 'Arquivo.zip');
  assert.equal(attachmentName('attachment; filename="../pasta/arquivo.zip"', 'Arquivo.zip'), '.._pasta_arquivo.zip');
});
test('erro ao abrir seletor é visível e não inicia download silencioso', async () => {
  await assert.rejects(
    saveFile(request, {
      pickFile: async () => {
        throw new DOMException('Indisponível', 'SecurityError');
      },
      fetchFile: async () => assert.fail(),
      downloadBlob: () => assert.fail(),
    }),
    /Não foi possível abrir a escolha de local/,
  );
});
