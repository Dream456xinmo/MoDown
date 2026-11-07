import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/global.css'
import './styles/md-themes.css'
import { useWorkspace } from './stores/workspace'
import { IS_MOBILE_BUILD } from './utils/device'
import { installBackHook } from './composables/backstack'

// 手机/平板壳里系统返回键先问前端（关对话框、回编辑页），都没接住才由原生退出
installBackHook()
document.title = IS_MOBILE_BUILD ? 'MoDown' : 'MoDown — 本地 Markdown 编辑器'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

const ws = useWorkspace(pinia)
// 先把工作台画出来（顶栏 / 空文件树），设置与文件树在后台加载：
// App.vue 的 onMounted 会 await 同一个 init（幂等），再打开默认文件。
app.mount('#app')
void ws.init()
