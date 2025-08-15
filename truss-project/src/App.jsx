import { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

// Это React-приложение, которое представляет собой концептуальную 3D-модель
// каркаса входной группы, основанную на предоставленных эскизах и размерах.
// Модель включает в себя 8 колонн, балки и выступающий козырек.
// Также в приложении есть функции для генерации концептуальной документации и чертежей.
// ВАЖНО: Это приложение предназначено только для демонстрации и не заменяет
// профессиональное инженерное проектирование.

// Централизованная функция для вызова API Gemini с логикой повторных попыток.
async function callGeminiAPI(prompt) {
    let chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
    const payload = { contents: chatHistory };
    const apiKey = "";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    let responseText = "Не удалось получить ответ. Попробуйте еще раз.";
    let retries = 0;
    const maxRetries = 3;
    let delay = 1000;

    while (retries < maxRetries) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const result = await response.json();
                if (result.candidates && result.candidates.length > 0 &&
                    result.candidates[0].content && result.candidates[0].content.parts &&
                    result.candidates[0].content.parts.length > 0) {
                    return result.candidates[0].content.parts[0].text;
                }
            } else {
                throw new Error(`API error: ${response.status}`);
            }
        } catch (error) {
            console.error('Fetch error:', error);
            retries++;
            if (retries < maxRetries) {
                await new Promise(res => setTimeout(res, delay));
                delay *= 2;
            }
        }
    }
    return responseText;
}

// Главный компонент приложения
const App = () => {
    const canvasRef = useRef();
    const drawingCanvasRef = useRef();
    const [kmText, setKmText] = useState("");
    const [kmdText, setKmdText] = useState("");
    const [drawingText, setDrawingText] = useState("");
    const [loadingKm, setLoadingKm] = useState(false);
    const [loadingKmd, setLoadingKmd] = useState(false);
    const [loadingDrawingText, setLoadingDrawingText] = useState(false);
    const [loadingDrawingCanvas, setLoadingDrawingCanvas] = useState(false);
    const [isExploded, setIsExploded] = useState(false);
    const sceneRef = useRef(new THREE.Scene());
    const cameraRef = useRef();
    const rendererRef = useRef();
    const controlsRef = useRef();
    const structureGroupRef = useRef(new THREE.Group());
    const initialPositionsRef = useRef([]);

    // Функция для рендеринга 3D-сцены
    const renderScene = useCallback(() => {
        const container = canvasRef.current;
        if (!container) return;

        // Удаляем старые рендереры, если они есть
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }

        const scene = sceneRef.current;
        scene.background = new THREE.Color(0xf1f5f9); // slate-100

        const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 1000);
        camera.position.set(3, 3, 4);
        camera.lookAt(new THREE.Vector3(0, 1.5, 0));
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        rendererRef.current = renderer;
        container.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controlsRef.current = controls;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
        scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
        directionalLight.position.set(5, 10, 7);
        scene.add(directionalLight);

        const steelMaterial = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9, roughness: 0.3 }); // slate-700
        const gridHelper = new THREE.GridHelper(6, 10, 0x94a3b8, 0x94a3b8);
        scene.add(gridHelper);
        
        const structureGroup = structureGroupRef.current;
        structureGroup.clear();
        initialPositionsRef.current = [];

        // Размеры
        const columnSpacing = 0.6; // 600 мм
        const structureDepth = 0.6; // 600 мм
        const canopyOverhang = 0.6; // 600 мм
        const mainHeight = 3.0; // Примерная высота
        const canopyHeight = 0.6; // 600 мм
        const profileSize = 0.06; // 60 мм

        const createBeam = (start, end) => {
            const startVec = new THREE.Vector3(...start);
            const endVec = new THREE.Vector3(...end);
            const length = startVec.distanceTo(endVec);
            const geo = new THREE.BoxGeometry(profileSize, length, profileSize);
            const mesh = new THREE.Mesh(geo, steelMaterial);
            mesh.position.lerpVectors(startVec, endVec, 0.5);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), endVec.clone().sub(startVec).normalize());
            return mesh;
        };
        
        const members = [];
        // 8 колонн
        const totalWidth = 3 * columnSpacing;
        for (let i = 0; i < 4; i++) {
            const x = -totalWidth / 2 + i * columnSpacing;
            // Задний ряд
            members.push(createBeam([x, 0, 0], [x, mainHeight, 0]));
            // Передний ряд
            members.push(createBeam([x, 0, -structureDepth], [x, mainHeight, -structureDepth]));
        }

        // Балки основного уровня
        members.push(createBeam([-totalWidth/2, mainHeight, 0], [totalWidth/2, mainHeight, 0]));
        members.push(createBeam([-totalWidth/2, mainHeight, -structureDepth], [totalWidth/2, mainHeight, -structureDepth]));
        for (let i = 0; i < 4; i++) {
            const x = -totalWidth / 2 + i * columnSpacing;
            members.push(createBeam([x, mainHeight, 0], [x, mainHeight, -structureDepth]));
        }

        // Стойки козырька
        for (let i = 0; i < 4; i++) {
            const x = -totalWidth / 2 + i * columnSpacing;
            members.push(createBeam([x, mainHeight, -structureDepth], [x, mainHeight + canopyHeight, -structureDepth]));
        }

        // Балки козырька
        const canopyDepth = structureDepth + canopyOverhang;
        members.push(createBeam([-totalWidth/2, mainHeight + canopyHeight, -structureDepth], [totalWidth/2, mainHeight + canopyHeight, -structureDepth]));
        members.push(createBeam([-totalWidth/2, mainHeight + canopyHeight, -canopyDepth], [totalWidth/2, mainHeight + canopyHeight, -canopyDepth]));
        for (let i = 0; i < 4; i++) {
            const x = -totalWidth / 2 + i * columnSpacing;
            members.push(createBeam([x, mainHeight + canopyHeight, -structureDepth], [x, mainHeight + canopyHeight, -canopyDepth]));
        }
        
        members.forEach(member => {
            structureGroup.add(member);
            initialPositionsRef.current.push(member.position.clone());
        });

        scene.add(structureGroup);

        const animate = () => {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        const onWindowResize = () => {
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        };
        window.addEventListener('resize', onWindowResize);
        
        return () => {
            window.removeEventListener('resize', onWindowResize);
            if(container && renderer.domElement) {
                container.removeChild(renderer.domElement);
            }
        };
    }, []);
    
    useEffect(() => {
        renderScene();
    }, [renderScene]);

    useEffect(() => {
        const explode = () => {
            structureGroupRef.current.children.forEach((member, index) => {
                const initialPos = initialPositionsRef.current[index];
                if (!initialPos) return;

                const target = isExploded 
                    ? new THREE.Vector3(
                        initialPos.x * 1.2, 
                        initialPos.y * 1.1, 
                        initialPos.z * 1.5
                      )
                    : initialPos;
                
                member.position.lerp(target, 0.1);
            });
        };
        
        let animationFrameId;
        const animateExplode = () => {
            explode();
            animationFrameId = requestAnimationFrame(animateExplode);
        }
        animateExplode();

        return () => {
            cancelAnimationFrame(animationFrameId);
        }
    }, [isExploded]);
    
    const handleGenerateKm = async () => {
        setLoadingKm(true);
        const prompt = `Сгенерируй детальное описание для раздела "КМ (Конструкции Металлические)" для каркаса входной группы. Конструкция состоит из 8 колонн, балок и козырька. Расстояние между колоннами 600 мм, козырек выступает на 1200 мм. Профиль - квадратная труба 60х60х2 мм. Опиши общие данные, спецификацию, нагрузки и требования к монтажу.`;
        const text = await callGeminiAPI(prompt);
        setKmText(text);
        setLoadingKm(false);
    };

    const handleGenerateKmd = async () => {
        setLoadingKmd(true);
        const prompt = `Сгенерируй детальное описание для раздела "КМД (Деталировочные)" для каркаса входной группы. Конструкция из профиля 60х60х2 мм. Упомяни сборочные чертежи, деталировку колонн и балок, узлы сварки и ведомость метизов.`;
        const text = await callGeminiAPI(prompt);
        setKmdText(text);
        setLoadingKmd(false);
    };
    
    const handleGenerateDrawingText = async () => {
        setLoadingDrawingText(true);
        const prompt = `Сгенерируй детальное текстовое описание для чертежа узла соединения колонны и балки для каркаса входной группы. Профиль 60х60х2 мм. Укажи размеры, тип сварного шва и технические требования.`;
        const text = await callGeminiAPI(prompt);
        setDrawingText(text);
        setLoadingDrawingText(false);
    };

    const handleGenerateDrawingCanvas = () => {
      setLoadingDrawingCanvas(true);
      const canvas = drawingCanvasRef.current;
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;
      
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      
      ctx.strokeStyle = '#4b5563';
      ctx.lineWidth = 2;
      ctx.font = '12px Arial';
      ctx.fillStyle = '#1e293b';
      
      const p = 60; // profile size
      const cx = width / 2;
      const cy = height / 2;
      
      // Column
      ctx.strokeRect(cx - p/2, cy, p, 100);
      // Beam
      ctx.strokeRect(cx, cy - p/2, 100, p);
      
      // Weld symbol
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + 10, cy - 10);
      ctx.lineTo(cx + 10, cy);
      ctx.closePath();
      ctx.stroke();
      
      ctx.fillText('Узел 1', cx - 20, cy - 20);
      ctx.fillText('Сварной шов T1', cx + 20, cy - 20);
      
      setLoadingDrawingCanvas(false);
    };

    return (
        <div className="p-8 bg-slate-50 text-slate-800 rounded-lg shadow-xl font-sans">
            <div className="flex flex-col lg:flex-row gap-8">
                <div className="lg:w-1/2">
                    <h2 className="text-3xl font-bold text-slate-900 mb-6">Интерактивная Модель Входной Группы</h2>
                    <p className="text-sm text-slate-600 mb-4">
                        3D-модель каркаса входной группы, созданная по вашим эскизам и размерам. Используйте мышь для вращения и масштабирования.
                    </p>
                    <div className="bg-white rounded-xl shadow-inner border border-slate-200 aspect-video mb-4 relative">
                        <div ref={canvasRef} className="w-full h-full"></div>
                        <p className="absolute bottom-2 left-1/2 -translate-x-1/2 text-center text-xs text-slate-400">
                            (Концептуальная 3D-визуализация)
                        </p>
                    </div>
                    <button
                        onClick={() => setIsExploded(!isExploded)}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md shadow-sm hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
                    >
                        {isExploded ? "Собрать модель" : "Взорванный вид"}
                    </button>
                </div>

                <div className="lg:w-1/2">
                    <h2 className="text-3xl font-bold text-slate-900 mb-6">Концептуальная документация</h2>
                    <p className="text-sm text-slate-600 mb-4">
                        Сгенерируйте примеры текста для разделов КМ, КМД и чертежей.
                    </p>
                    
                    <div className="space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <h3 className="text-lg font-semibold text-slate-900">Раздел КМ и КМД</h3>
                            <div className="flex gap-4 mt-4">
                                <button onClick={handleGenerateKm} disabled={loadingKm} className="w-1/2 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50">
                                    {loadingKm ? '...' : '✨ КМ'}
                                </button>
                                <button onClick={handleGenerateKmd} disabled={loadingKmd} className="w-1/2 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50">
                                    {loadingKmd ? '...' : '✨ КМД'}
                                </button>
                            </div>
                            {kmText && <div className="mt-4 p-4 text-sm text-slate-700 bg-slate-50 rounded-lg whitespace-pre-wrap">{kmText}</div>}
                            {kmdText && <div className="mt-4 p-4 text-sm text-slate-700 bg-slate-50 rounded-lg whitespace-pre-wrap">{kmdText}</div>}
                        </div>
                        
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                            <h3 className="text-lg font-semibold text-slate-900">Генерация чертежей узла</h3>
                            <div className="flex gap-4 mt-4">
                                <button onClick={handleGenerateDrawingText} disabled={loadingDrawingText} className="w-1/2 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50">
                                    {loadingDrawingText ? '...' : '📄 Текст'}
                                </button>
                                <button onClick={handleGenerateDrawingCanvas} disabled={loadingDrawingCanvas} className="w-1/2 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md shadow-sm hover:bg-blue-700 disabled:opacity-50">
                                    {loadingDrawingCanvas ? '...' : '✏️ Чертеж'}
                                </button>
                            </div>
                            {drawingText && <div className="mt-4 p-4 text-sm text-slate-700 bg-slate-50 rounded-lg whitespace-pre-wrap">{drawingText}</div>}
                            <div className="mt-4 flex justify-center items-center h-48 bg-slate-50 rounded-lg shadow-inner border border-slate-200">
                                <canvas ref={drawingCanvasRef} width="300" height="192"></canvas>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="mt-8 text-sm text-center text-red-600 p-4 bg-red-50 border border-red-200 rounded-lg">
                <strong>Отказ от ответственности:</strong> Данное приложение является исключительно концептуальной демонстрацией. Оно не должно использоваться для реального проектирования, расчета или изготовления строительных конструкций.
            </div>
        </div>
    );
};

export default App;
