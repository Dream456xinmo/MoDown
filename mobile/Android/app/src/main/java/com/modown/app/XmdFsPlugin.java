package com.modown.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * MoDown 的 Android 文件桥（SAF / Storage Access Framework）。
 *
 * 职责范围（刻意与前端 mock 分工，避免两套实现互相打架）：
 * - **系统目录工作区**：用系统文件管理器（ACTION_OPEN_DOCUMENT_TREE）选一个目录当工作区，
 *   申请可持久化授权并记进「打开记录」；该目录内的文件树、读写、增删改都走 SAF。
 * - **导出/另存为**：用系统文件管理器（ACTION_CREATE_DOCUMENT）让用户选保存位置。
 * - 图片等资源以 data URL 读写（WebView 不能直接加载 content:// ，Phase 3 再谈直链）。
 *
 * 「本地工作区」（App 内部默认工作区）不在这里实现，仍由前端 mock 桥负责；
 * 所以本插件的方法都要求「当前工作区是系统目录」，否则直接报错，避免静默走错存储。
 *
 * 路径约定：一律用「工作区相对路径」（/notes/a.md），内部再映射成 SAF documentId。
 */
@CapacitorPlugin(name = "XmdFs")
public class XmdFsPlugin extends Plugin {

    private static final String PREFS = "xmd_workspaces";
    private static final String KEY_LIST = "list";
    private static final String KEY_ACTIVE = "active";

    /** 本地工作区（App 内部目录）的固定 id，前端 mock 桥使用 */
    private static final String LOCAL_ID = "local";

    /** 系统目录一层的文件数上限与递归深度上限（SAF 每次查询都是一次 IPC，防止选到 /sdcard 卡死） */
    private static final int MAX_NODES = 3000;
    private static final int MAX_DEPTH = 12;

    private static final String MIME_DIR = DocumentsContract.Document.MIME_TYPE_DIR;

    /** 工作区相对路径 → SAF documentId 的缓存（getTree 时建立，增删改后同步维护） */
    private final Map<String, String> docIds = new HashMap<>();
    private String docIdsTree = "";

    private static final String[] DOC_COLUMNS = new String[] {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE
    };

    // ------------------------------------------------------------------ 工作区记录

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    /** 打开记录（只含系统目录；本地工作区是恒存在的隐式记录） */
    private List<JSONObject> readList() {
        List<JSONObject> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs().getString(KEY_LIST, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && o.optString("uri", "").length() > 0) out.add(o);
            }
        } catch (Exception ignored) {
            // 记录损坏时当作空列表，不阻塞用户
        }
        return out;
    }

    private void writeList(List<JSONObject> items) {
        JSONArray arr = new JSONArray();
        for (JSONObject o : items) arr.put(o);
        prefs().edit().putString(KEY_LIST, arr.toString()).apply();
    }

    private JSObject localItem() {
        JSObject o = new JSObject();
        o.put("id", LOCAL_ID);
        o.put("kind", "local");
        o.put("name", "本地工作区");
        o.put("removable", false);
        o.put("available", true);
        return o;
    }

    private JSObject stateObject() {
        JSArray items = new JSArray();
        items.put(localItem());
        for (JSONObject rec : readList()) {
            Uri uri = Uri.parse(rec.optString("uri"));
            JSObject o = new JSObject();
            o.put("id", rec.optString("id"));
            o.put("kind", "system");
            o.put("name", rec.optString("name"));
            o.put("uri", rec.optString("uri"));
            o.put("removable", true);
            o.put("available", canRead(uri));
            items.put(o);
        }
        String active = prefs().getString(KEY_ACTIVE, LOCAL_ID);
        JSObject out = new JSObject();
        out.put("active", active == null ? LOCAL_ID : active);
        out.put("items", items);
        return out;
    }

    // ------------------------------------------------------------------ 工作区方法

    @PluginMethod
    public void listWorkspaces(PluginCall call) {
        call.resolve(stateObject());
    }

    /** 弹系统文件管理器选一个目录；取消时 resolve 空对象 */
    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION |
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "pickDirectoryResult");
    }

    @ActivityCallback
    private void pickDirectoryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.resolve(); // 用户取消
            return;
        }
        int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (flags == 0) flags = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
        try {
            resolver().takePersistableUriPermission(uri, flags);
        } catch (Exception first) {
            try {
                // 有些 provider 只给读权限，退回只读
                resolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {
                call.reject("无法取得该目录的持久访问权限");
                return;
            }
        }
        if (!canRead(uri)) {
            call.reject("无法读取所选目录");
            return;
        }

        String id = "sys:" + uri;
        List<JSONObject> list = readList();
        for (int i = list.size() - 1; i >= 0; i--) {
            if (id.equals(list.get(i).optString("id"))) list.remove(i); // 同一目录只留一条
        }
        JSObject rec = new JSObject();
        rec.put("id", id);
        rec.put("uri", uri.toString());
        rec.put("name", displayNameOf(uri));
        list.add(0, rec);
        writeList(list);
        prefs().edit().putString(KEY_ACTIVE, id).apply();
        invalidateCache();

        JSObject out = new JSObject();
        out.put("id", id);
        out.put("kind", "system");
        out.put("name", rec.optString("name"));
        out.put("uri", uri.toString());
        out.put("removable", true);
        out.put("available", true);
        call.resolve(out);
    }

    @PluginMethod
    public void setActiveWorkspace(PluginCall call) {
        String id = call.getString("id", LOCAL_ID);
        prefs().edit().putString(KEY_ACTIVE, id).apply();
        invalidateCache();
        call.resolve(stateObject());
    }

    @PluginMethod
    public void removeWorkspace(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty() || LOCAL_ID.equals(id)) {
            call.reject("本地工作区不能删除");
            return;
        }
        List<JSONObject> list = readList();
        for (int i = list.size() - 1; i >= 0; i--) {
            JSONObject o = list.get(i);
            if (!id.equals(o.optString("id"))) continue;
            try {
                resolver().releasePersistableUriPermission(
                    Uri.parse(o.optString("uri")),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
            } catch (Exception ignored) {
                // 授权已失效时忽略即可
            }
            list.remove(i);
        }
        writeList(list);
        if (id.equals(prefs().getString(KEY_ACTIVE, LOCAL_ID))) {
            prefs().edit().putString(KEY_ACTIVE, LOCAL_ID).apply();
            invalidateCache();
        }
        call.resolve(stateObject());
    }

    /** 当前活动工作区若是系统目录，返回它的 tree Uri；本地工作区返回 null */
    private Uri activeTree() {
        String id = prefs().getString(KEY_ACTIVE, LOCAL_ID);
        if (id == null || LOCAL_ID.equals(id)) return null;
        for (JSONObject o : readList()) {
            if (id.equals(o.optString("id"))) {
                Uri uri = Uri.parse(o.optString("uri"));
                if (canRead(uri)) return uri;
                return null;
            }
        }
        return null;
    }

    private Uri requireTree(PluginCall call) {
        Uri tree = activeTree();
        if (tree == null) {
            call.reject("当前工作区不是可访问的系统目录，请先通过「打开文件夹」选择系统目录");
        }
        return tree;
    }

    // ------------------------------------------------------------------ 文件树

    @PluginMethod
    public void getTree(PluginCall call) {
        Uri tree = requireTree(call);
        if (tree == null) return;
        try {
            invalidateCache(tree);
            int[] budget = new int[] { MAX_NODES };
            String rootId = DocumentsContract.getTreeDocumentId(tree);
            JSArray nodes = listChildren(tree, rootId, "", 1, budget);
            JSObject out = new JSObject();
            out.put("nodes", nodes);
            out.put("truncated", budget[0] <= 0);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("读取目录失败：" + messageOf(e), e);
        }
    }

    private JSArray listChildren(Uri tree, String parentDocId, String parentPath, int depth, int[] budget) {
        List<JSONObject> dirs = new ArrayList<>();
        List<JSONObject> files = new ArrayList<>();
        if (depth > MAX_DEPTH || budget[0] <= 0) return new JSArray();

        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentDocId);
        Cursor c = null;
        try {
            c = resolver().query(childrenUri, DOC_COLUMNS, null, null, null);
            while (c != null && c.moveToNext()) {
                if (budget[0]-- <= 0) break;
                String docId = c.getString(0);
                String name = c.getString(1);
                if (docId == null || name == null || name.isEmpty()) continue;
                boolean isDir = MIME_DIR.equals(c.getString(2));
                String path = parentPath + "/" + name;
                docIds.put(path, docId);

                JSObject node = new JSObject();
                node.put("name", name);
                node.put("path", path);
                node.put("isDir", isDir);
                if (isDir) {
                    node.put("children", listChildren(tree, docId, path, depth + 1, budget));
                    dirs.add(node);
                } else {
                    files.add(node);
                }
            }
        } catch (Exception ignored) {
            // 单个目录不可读（如 Android/data）时跳过，不影响其余目录
        } finally {
            if (c != null) c.close();
        }
        sortByName(dirs);
        sortByName(files);
        JSArray out = new JSArray();
        for (JSONObject o : dirs) out.put(o);
        for (JSONObject o : files) out.put(o);
        return out;
    }

    private static void sortByName(List<JSONObject> list) {
        Collections.sort(list, (a, b) -> a.optString("name").compareToIgnoreCase(b.optString("name")));
    }

    // ------------------------------------------------------------------ 读写

    @PluginMethod
    public void readText(PluginCall call) {
        Uri tree = requireTree(call);
        if (tree == null) return;
        String path = call.getString("path");
        try {
            Uri doc = docUri(tree, path);
            if (doc == null) {
                call.reject("文件不存在：" + path);
                return;
            }
            JSObject out = new JSObject();
            out.put("text", new String(readAll(resolver().openInputStream(doc)), StandardCharsets.UTF_8));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("读取失败：" + messageOf(e), e);
        }
    }

    @PluginMethod
    public void writeText(PluginCall call) {
        Uri tree = requireTree(call);
        if (tree == null) return;
        String path = call.getString("path");
        String text = call.getString("text", "");
        try {
            Uri doc = ensureFile(tree, path);
            OutputStream os = openOut(doc);
            try {
                os.write(text.getBytes(StandardCharsets.UTF_8));
                os.flush();
            } finally {
                os.close();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("写入失败：" + messageOf(e), e);
        }
    }

    /** 写二进制（data URL 解码后落盘），用于导入图片 / 附件 */
    @PluginMethod
    public void writeDataUrl(PluginCall call) {
        Uri tree = requireTree(call);
        if (tree == null) return;
        String path = call.getString("path");
        String dataUrl = call.getString("dataUrl", "");
        try {
            Uri doc = ensureFile(tree, path);
            OutputStream os = openOut(doc);
            try {
                os.write(decodeDataUrl(dataUrl));
                os.flush();
            } finally {
                os.close();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("写入失败：" + messageOf(e), e);
        }
    }

    /** 把资源文件读成 data URL（导出时内联图片用） */
    @PluginMethod
    public void readDataUrl(PluginCall call) {
        Uri tree = requireTree(call);
        if (tree == null) return;
        String path = call.getString("path");
        try {
            Uri doc = docUri(tree, path);
            if (doc == null) {
                call.resolve();
                return;
            }
            String mime = resolver().getType(doc);
            if (mime == null || mime.isEmpty()) mime = mimeOfPath(path);
            byte[] bytes = readAll(resolver().openInputStream(doc));
            JSObject out = new JSObject();
            out.put("dataUrl", "data:" + mime + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
            call.resolve(out);
        } catch (Exception e) {
            call.reject("读取失败：" + messageOf(e), e);
        }
    }

    @PluginMethod
    public void createFile(PluginCall call) {
        Uri tree = requireTree(call);
        if (tree == null) return;
        String path = call.getString("path");
        try {
            ensureFile(tree, path);
            call.resolve();
        } catch (Exception e) {
            call.reject("新建文件失败：" + messageOf(e), e);
        }
    }

    @PluginMethod
    public void createDir(PluginCall call) {
        Uri tree = requireTree(call);
        if (tree == null) return;
        String path = call.getString("path");
        try {
            ensureDir(tree, path);
            call.resolve();
        } catch (Exception e) {
            call.reject("新建文件夹失败：" + messageOf(e), e);
        }
    }

    @PluginMethod
    public void removeItem(PluginCall call) {
        Uri tree = requireTree(call);
        if (tree == null) return;
        String path = call.getString("path");
        try {
            Uri doc = docUri(tree, path);
            if (doc == null) {
                call.resolve(); // 已经不在了，视作成功
                return;
            }
            if (!DocumentsContract.deleteDocument(resolver(), doc)) {
                throw new IOException("系统拒绝删除");
            }
            dropCache(path);
            call.resolve();
        } catch (Exception e) {
            call.reject("删除失败：" + messageOf(e), e);
        }
    }

    @PluginMethod
    public void renameItem(PluginCall call) {
        Uri tree = requireTree(call);
        if (tree == null) return;
        String from = call.getString("from");
        String to = call.getString("to");
        try {
            Uri doc = docUri(tree, from);
            if (doc == null) throw new IOException("文件不存在");
            String newName = lastSegment(to);
            Uri renamed = DocumentsContract.renameDocument(resolver(), doc, newName);
            if (renamed == null) throw new IOException("系统不支持重命名");
            dropCache(from);
            docIds.put(to, DocumentsContract.getDocumentId(renamed));
            call.resolve();
        } catch (Exception e) {
            call.reject("重命名失败：" + messageOf(e), e);
        }
    }

    /** 用系统默认应用打开（Office / PDF 等无法内嵌预览的类型） */
    @PluginMethod
    public void openDoc(PluginCall call) {
        Uri tree = requireTree(call);
        if (tree == null) return;
        String path = call.getString("path");
        try {
            Uri doc = docUri(tree, path);
            if (doc == null) throw new IOException("文件不存在");
            String mime = resolver().getType(doc);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(doc, mime == null || mime.isEmpty() ? mimeOfPath(path) : mime);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("没有可打开该文件的应用：" + messageOf(e), e);
        }
    }

    // ------------------------------------------------------------------ 导出另存为

    /** 弹系统文件管理器选保存位置（ACTION_CREATE_DOCUMENT），取消时 resolve 空对象 */
    @PluginMethod
    public void saveAs(PluginCall call) {
        String mime = sanitizeMime(call.getString("mime", "text/plain"));
        String fileName = call.getString("fileName", "untitled.md");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        startActivityForResult(call, intent, "saveAsResult");
    }

    @ActivityCallback
    private void saveAsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            call.resolve(); // 用户取消
            return;
        }
        try {
            byte[] bytes = decodeDataUrl(call.getString("content", ""));
            OutputStream os = openOut(uri);
            try {
                os.write(bytes);
                os.flush();
            } finally {
                os.close();
            }
            JSObject out = new JSObject();
            out.put("name", displayNameOf(uri));
            out.put("uri", uri.toString());
            call.resolve(out);
        } catch (Exception e) {
            call.reject("保存失败：" + messageOf(e), e);
        }
    }

    // ------------------------------------------------------------------ PDF 导出 / 外链

    /**
     * 打印用的离屏 WebView。
     * 系统打印预览是异步的：用户在里面挑「保存为 PDF」和存储目录时，打印服务仍在向这个 WebView 取页面，
     * 所以调起打印后不能马上销毁 —— 留着复用，下次导出只换内容（Activity 变了就重建）。
     */
    private WebView printWeb;

    /** 渲染兜底超时：大文档 + 低端机也可能慢，但绝不能让前端的 Promise 永远悬着 */
    private static final long PDF_TIMEOUT_MS = 25000;

    /**
     * HTML → PDF：走系统打印管道（WebView 的 PrintDocumentAdapter + PrintManager.print）。
     *
     * 安卓公开 API 不允许应用自己驱动适配器把 PDF 直接写进文件
     * （LayoutResultCallback / WriteResultCallback 的构造器是包内私有的，也没有 onCreateLayout），
     * 所以这里是调起系统打印预览：用户在打印界面里选「保存为 PDF」，再由系统存储选择器挑手机里的目录。
     * 取消打印即等于取消导出，前端不谎报成功。
     *
     * @param call fileName（作打印任务名，方便在下载/打印记录里认出文件）+ html（完整文档，图片已由前端内联成 data URL）
     */
    @PluginMethod
    public void exportPdf(PluginCall call) {
        final String html = call.getString("html", "");
        if (html == null || html.trim().isEmpty()) {
            call.reject("导出内容为空");
            return;
        }
        final String fileName = safeBaseName(call.getString("fileName", "document"));
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("当前界面不可用，无法生成 PDF");
            return;
        }
        activity.runOnUiThread(() -> renderForPrint(call, activity, fileName, html));
    }

    private void renderForPrint(final PluginCall call, Activity activity, final String fileName, String html) {
        final WebView web = obtainPrintWeb(activity);
        if (web == null) {
            call.reject("无法创建打印用的 WebView");
            return;
        }
        final Handler main = new Handler(Looper.getMainLooper());
        final AtomicBoolean settled = new AtomicBoolean(false);
        final Runnable bail = () -> {
            if (settled.compareAndSet(false, true)) {
                call.reject("生成 PDF 超时，请重试，或改用「导出 HTML」后用浏览器打开再打印为 PDF");
            }
        };
        main.postDelayed(bail, PDF_TIMEOUT_MS);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                // 排版与 data URL 图片解码需要一点时间，等一小会儿再交给打印服务
                main.postDelayed(() -> {
                    main.removeCallbacks(bail);
                    if (settled.compareAndSet(false, true)) launchPrint(call, view, fileName);
                }, 400);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request == null || request.isForMainFrame()) {
                    main.removeCallbacks(bail);
                    if (settled.compareAndSet(false, true)) {
                        call.reject("PDF 渲染失败：" + (error == null ? "未知错误" : error.getDescription()));
                    }
                }
            }
        });

        try {
            web.loadDataWithBaseURL("file:///android_asset/", html, "text/html", "UTF-8", null);
        } catch (Exception e) {
            main.removeCallbacks(bail);
            if (settled.compareAndSet(false, true)) call.reject("PDF 渲染失败：" + messageOf(e));
        }
    }

    /** 打印只能用 Activity 上下文拿到的 PrintManager（application 上下文拉不起打印界面） */
    private void launchPrint(PluginCall call, WebView web, String fileName) {
        try {
            PrintManager pm = (PrintManager) web.getContext().getSystemService(Context.PRINT_SERVICE);
            if (pm == null) {
                call.reject("系统没有可用的打印服务，无法生成 PDF；可先「导出 HTML」再用浏览器打开");
                return;
            }
            PrintAttributes attrs = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setResolution(new PrintAttributes.Resolution("xmd", "xmd", 300, 300))
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .build();
            PrintDocumentAdapter adapter = web.createPrintDocumentAdapter(fileName);
            pm.print(fileName, adapter, attrs);
            JSObject out = new JSObject();
            out.put("printed", true);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("调起打印失败：" + messageOf(e));
        }
    }

    /** 复用同一个离屏 WebView：每次导出只换内容；Activity 变了（界面重建）就重新造一个 */
    private WebView obtainPrintWeb(Activity activity) {
        if (printWeb != null && printWeb.getContext() == activity) return printWeb;
        destroyPrintWeb();
        WebView web = new WebView(activity);
        web.setBackgroundColor(Color.WHITE);
        web.getSettings().setJavaScriptEnabled(false);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setTextZoom(100);
        ViewGroup root = (ViewGroup) activity.findViewById(android.R.id.content);
        if (root != null) {
            // 没被 attach 过的 WebView 拿不到有效排版宽度，部分机型会排出空白页；
            // 1px 高 + 全透明：看不见，也不抢触摸（非 clickable，触摸会落到下面的界面）
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 1);
            web.setAlpha(0f);
            try {
                root.addView(web, lp);
            } catch (Exception ignored) {
                // 挂不上（内容区不可用等）就退回纯离屏排版
            }
        }
        printWeb = web;
        return web;
    }

    private void destroyPrintWeb() {
        if (printWeb == null) return;
        ViewParent parent = printWeb.getParent();
        try {
            if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(printWeb);
        } catch (Exception ignored) {
            // 没挂上就不用摘
        }
        try {
            printWeb.destroy();
        } catch (Exception ignored) {
            // 销毁失败交给 GC
        }
        printWeb = null;
    }

    /** 用系统浏览器打开外链：WebView 里 window.open / target=_blank 往往没有任何响应 */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String raw = call.getString("url", "");
        String url = raw == null ? "" : raw.trim();
        if (url.isEmpty()) {
            call.reject("没有指定链接");
            return;
        }
        String lower = url.toLowerCase();
        if (!lower.startsWith("http://") && !lower.startsWith("https://")
            && !lower.startsWith("mailto:") && !lower.startsWith("tel:")) {
            call.reject("只支持 http / https / mailto / tel 链接");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("没有可打开该链接的应用：" + messageOf(e), e);
        }
    }

    // ------------------------------------------------------------------ 软键盘兜底

    /**
     * 显式要求系统弹出软键盘，并回报一份诊断回执。
     *
     * 大屏（平板）上 Chromium 有时聚焦了可编辑节点却不向壳请求 IME（窗口尺寸 / 焦点判定），
     * 表现为「光标在闪、键盘不弹」；用返回键收起键盘后焦点仍在编辑区里，再点一下也不会重新弹。
     * 这两种情况前端都补不了，只能由原生 InputMethodManager 直接要求弹出。
     * 键盘已经显示时该调用是空操作，不会来回切换。
     *
     * ⚠️ 前端只在「等过 Chromium、确认它没弹」之后才调这里（见 composables/softKeyboard.ts 的文件头）：
     * 这里动手越早越坏 —— 抢焦点会让 Chromium 自己那次输入会话落空，连手机版都会打不了字。
     * 所以下面只在 WebView 真的没有 view 级焦点时才 `requestFocus()`，
     * **不要**再用 `requestFocusFromTouch()`（触摸模式下把焦点抢回 WebView，正是上面那个坑）。
     *
     * 回执不是给正常流程用的：前端只在「补弹后键盘仍不可见」时把它显示出来，
     * 让用户截图反馈设备上的真实原因（焦点 / 输入连接 / 键盘可见性 / softInputMode），
     * 因为「键盘弹不出来」在真机上没有任何日志可看。
     */
    @PluginMethod
    public void showKeyboard(PluginCall call) {
        Activity activity = getActivity();
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (activity == null || webView == null) {
            call.resolve(keyboardReport(null, null, false, activity == null ? "no-activity" : "no-webview"));
            return;
        }
        activity.runOnUiThread(() -> {
            boolean shown = false;
            String reason = "";
            try {
                // 有焦点就别碰：WebView 重新拿 view 级焦点会让 Chromium 重来一次输入会话
                if (!webView.hasFocus()) webView.requestFocus();
                InputMethodManager imm =
                    (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
                if (imm != null) {
                    shown = imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
                } else {
                    reason = "no-ime";
                }
            } catch (Exception e) {
                // 弹不出来也不该让前端报错：这只是兜底通道，原因放进回执
                reason = messageOf(e);
            }
            final boolean asked = shown;
            final String why = reason;
            // showSoftInput 的返回值只代表「请求已交给输入法」：真正连上输入连接、键盘上屏要等一帧，
            // 这里晚 200ms 再取样，回执里才是最终状态（直接 resolve 永远拿到"还没弹"）
            new Handler(Looper.getMainLooper())
                .postDelayed(() -> call.resolve(keyboardReport(activity, webView, asked, why)), 200);
        });
    }

    /** 软键盘诊断回执（字段名与前端 composables/softKeyboard.ts 的解析一一对应） */
    private JSObject keyboardReport(Activity activity, WebView webView, boolean shown, String reason) {
        JSObject r = new JSObject();
        r.put("shown", shown);
        if (reason != null && !reason.isEmpty()) r.put("reason", reason);
        if (activity == null || webView == null) {
            r.put("keyboard", false);
            return r;
        }
        boolean focus = false;
        boolean windowFocus = false;
        boolean ime = false;
        boolean keyboard = false;
        String mode = "";
        try {
            focus = webView.hasFocus();
            windowFocus = webView.hasWindowFocus();
            InputMethodManager imm =
                (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
            // isActive = WebView 是否持有输入法连接（连接在但键盘没上屏，正是最难查的那种）
            ime = imm != null && imm.isActive(webView);
            keyboard = keyboardVisible(webView);
            if (activity.getWindow() != null) {
                WindowManager.LayoutParams lp = activity.getWindow().getAttributes();
                if (lp != null) mode = softInputModeName(lp.softInputMode);
            }
        } catch (Exception ignored) {
            // 诊断字段取不到就算了，绝不能影响前端流程
        }
        r.put("focus", focus);
        r.put("windowFocus", windowFocus);
        r.put("ime", ime);
        r.put("keyboard", keyboard);
        r.put("softInputMode", mode);
        return r;
    }

    /** 键盘当前是否可见：API 30+ 直接问 WindowInsets 的 ime 类型，更老的按可见显示区域估算 */
    private static boolean keyboardVisible(WebView webView) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsets insets = webView.getRootWindowInsets();
                if (insets != null) return insets.isVisible(WindowInsets.Type.ime());
            }
            Rect r = new Rect();
            webView.getWindowVisibleDisplayFrame(r);
            int screenH = webView.getRootView().getHeight();
            return screenH > 0 && screenH - r.bottom > screenH / 4;
        } catch (Exception ignored) {
            return false;
        }
    }

    /** softInputMode 的数字对人没意义，回执里换成能直接看懂的短名（adjustResize+stateUnspecified） */
    @SuppressWarnings("deprecation")
    private static String softInputModeName(int mode) {
        String adjust;
        switch (mode & 0xf0) {
            case WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE: adjust = "adjustResize"; break;
            case WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN: adjust = "adjustPan"; break;
            case WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING: adjust = "adjustNothing"; break;
            default: adjust = "adjustUnspecified"; break;
        }
        String state;
        switch (mode & 0x0f) {
            case WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN: state = "stateHidden"; break;
            case WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN: state = "stateAlwaysHidden"; break;
            case WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE: state = "stateVisible"; break;
            case WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE: state = "stateAlwaysVisible"; break;
            case WindowManager.LayoutParams.SOFT_INPUT_STATE_UNCHANGED: state = "stateUnchanged"; break;
            default: state = "stateUnspecified"; break;
        }
        return adjust + "+" + state;
    }

    /** 只留能当文件名的部分：去掉分隔符与非法字符，顺带剥掉已有扩展名 */
    private static String safeBaseName(String raw) {
        String s = raw == null ? "" : raw.trim();
        s = s.replaceAll("[\\\\/:*?\"<>|]", "_");
        int dot = s.indexOf('.');
        if (dot > 0) s = s.substring(0, dot);
        if (s.isEmpty()) s = "document";
        return s.length() > 60 ? s.substring(0, 60) : s;
    }
    // ------------------------------------------------------------------ SAF 小工具

    private void invalidateCache() {
        docIds.clear();
        docIdsTree = "";
    }

    private void invalidateCache(Uri tree) {
        if (!tree.toString().equals(docIdsTree)) {
            docIds.clear();
            docIdsTree = tree.toString();
        }
    }

    private void dropCache(String path) {
        List<String> kill = new ArrayList<>();
        for (String k : docIds.keySet()) {
            if (k.equals(path) || k.startsWith(path + "/")) kill.add(k);
        }
        for (String k : kill) docIds.remove(k);
    }

    /** 工作区相对路径 → SAF 文档 Uri（不存在返回 null）；带缓存，未命中时从根逐段查找 */
    private Uri docUri(Uri tree, String path) {
        if (tree == null || path == null) return null;
        invalidateCache(tree);
        String docId = docIds.get(path);
        if (docId == null) {
            docId = DocumentsContract.getTreeDocumentId(tree);
            String acc = "";
            for (String seg : path.split("/")) {
                if (seg.isEmpty()) continue;
                acc = acc + "/" + seg;
                String child = findChild(tree, docId, seg);
                if (child == null) return null;
                docId = child;
                docIds.put(acc, child);
            }
        }
        return DocumentsContract.buildDocumentUriUsingTree(tree, docId);
    }

    /** 确保文件存在（父目录缺失则递归创建），返回它的文档 Uri */
    private Uri ensureFile(Uri tree, String path) throws IOException {
        Uri existing = docUri(tree, path);
        if (existing != null) return existing;
        Uri parent = ensureDir(tree, parentOf(path));
        String name = lastSegment(path);
        Uri created = DocumentsContract.createDocument(resolver(), parent, sanitizeMime(mimeOfPath(name)), name);
        if (created == null) throw new IOException("系统拒绝创建文件");
        docIds.put(path, DocumentsContract.getDocumentId(created));
        return created;
    }

    /** 确保目录存在（逐级创建），返回它的文档 Uri */
    private Uri ensureDir(Uri tree, String path) throws IOException {
        invalidateCache(tree);
        String docId = DocumentsContract.getTreeDocumentId(tree);
        Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, docId);
        String acc = "";
        for (String seg : path.split("/")) {
            if (seg.isEmpty()) continue;
            acc = acc + "/" + seg;
            String cached = docIds.get(acc);
            if (cached != null) {
                docId = cached;
                doc = DocumentsContract.buildDocumentUriUsingTree(tree, docId);
                continue;
            }
            String child = findChild(tree, docId, seg);
            if (child == null) {
                Uri created = DocumentsContract.createDocument(resolver(), doc, MIME_DIR, seg);
                if (created == null) throw new IOException("无法创建目录：" + acc);
                child = DocumentsContract.getDocumentId(created);
            }
            docId = child;
            docIds.put(acc, child);
            doc = DocumentsContract.buildDocumentUriUsingTree(tree, docId);
        }
        return doc;
    }

    /** 在某个目录下按显示名找子项，返回 documentId */
    private String findChild(Uri tree, String parentDocId, String name) {
        Cursor c = null;
        try {
            c = resolver().query(
                DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentDocId),
                DOC_COLUMNS,
                null,
                null,
                null
            );
            while (c != null && c.moveToNext()) {
                if (name.equals(c.getString(1))) return c.getString(0);
            }
        } catch (Exception ignored) {
            // 查询失败当作没找到
        } finally {
            if (c != null) c.close();
        }
        return null;
    }

    private boolean canRead(Uri tree) {
        Cursor c = null;
        try {
            c = resolver().query(
                DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree)),
                new String[] { DocumentsContract.Document.COLUMN_DOCUMENT_ID },
                null,
                null,
                null
            );
            return c != null;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.close();
        }
    }

    private String displayNameOf(Uri uri) {
        Cursor c = null;
        try {
            c = resolver().query(uri, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
                if (idx >= 0) {
                    String name = c.getString(idx);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (Exception ignored) {
            // 取不到就退回路径末段
        } finally {
            if (c != null) c.close();
        }
        String seg = uri.getLastPathSegment();
        return seg == null || seg.isEmpty() ? "系统目录" : seg;
    }

    private static String parentOf(String path) {
        int i = path.lastIndexOf('/');
        return i <= 0 ? "" : path.substring(0, i);
    }

    private static String lastSegment(String path) {
        int i = path.lastIndexOf('/');
        return i < 0 ? path : path.substring(i + 1);
    }

    /** 打开可写输出流：优先 "wt"（截断覆盖），少数 provider 不支持时退回默认模式 */
    private OutputStream openOut(Uri doc) throws IOException {
        try {
            OutputStream os = resolver().openOutputStream(doc, "wt");
            if (os != null) return os;
        } catch (Exception ignored) {
            // 退回默认写模式
        }
        OutputStream os = resolver().openOutputStream(doc);
        if (os == null) throw new IOException("无法打开输出流");
        return os;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        if (in == null) throw new IOException("无法打开输入流");
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        } finally {
            in.close();
        }
    }

    /** data URL（或纯文本）解码成字节；导出二进制与文本共用一条通道 */
    private static byte[] decodeDataUrl(String content) {
        if (content == null) return new byte[0];
        if (content.startsWith("data:")) {
            int comma = content.indexOf(',');
            if (comma > 0) {
                String meta = content.substring(5, comma);
                String payload = content.substring(comma + 1);
                if (meta.contains("base64")) {
                    try {
                        return Base64.decode(payload, Base64.DEFAULT);
                    } catch (Exception ignored) {
                        // 解码失败按原文写入
                    }
                }
                return payload.getBytes(StandardCharsets.UTF_8);
            }
        }
        return content.getBytes(StandardCharsets.UTF_8);
    }

    /** MIME 里不能带 charset 等参数，否则 ACTION_CREATE_DOCUMENT 可能找不到接收方 */
    private static String sanitizeMime(String mime) {
        if (mime == null || mime.isEmpty()) return "application/octet-stream";
        int semi = mime.indexOf(';');
        String clean = (semi > 0 ? mime.substring(0, semi) : mime).trim();
        return clean.isEmpty() ? "application/octet-stream" : clean;
    }

    private static String mimeOfPath(String path) {
        String name = lastSegment(path);
        int dot = name.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        String ext = name.substring(dot + 1).toLowerCase();
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        if (mime != null) return mime;
        if ("md".equals(ext) || "markdown".equals(ext)) return "text/markdown";
        return "application/octet-stream";
    }

    /** 打印适配器有时只给个 null/无 message 的异常，别让报错文案本身再崩一次 */
    private static String messageOf(Throwable e) {
        if (e == null) return "未知错误";
        String m = e.getMessage();
        return m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
    }
}
