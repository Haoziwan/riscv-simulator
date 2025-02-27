import React, { useCallback, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Connection,
  Edge,
  Node,
  Panel,
  OnNodesChange,
  OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
  ConnectionMode,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { ALUNode } from './nodes/ALUNode';
import { RegisterFileNode } from './nodes/RegisterFileNode';
import { MuxNode } from './nodes/MuxNode';
import { ImmGenNode } from './nodes/ImmGenNode';
import { ControlNode } from './nodes/ControlNode';
import { DataMemoryNode } from './nodes/DataMemoryNode';
import { InstructionMemoryNode } from './nodes/InstructionMemoryNode';
import { ALUControlNode } from './nodes/ALUControlNode';
import { PCNode } from './nodes/PCNode';
import { ConstantNode } from './nodes/ConstantNode';
import { SingleRegisterNode } from './nodes/SingleRegisterNode';
import { LabelNode } from './nodes/LabelNode';
import { AddNode } from './nodes/AddNode';
import { ForkNode } from './nodes/ForkNode';
import { InstrDistributerNode } from './nodes/InstrDistributerNode';
import { JumpControlNode } from './nodes/JumpControlNode';
import { useCircuitStore } from '../store/circuitStore';
import { Play, Pause, RotateCcw, StepForward, CheckCircle, Trash2 } from 'lucide-react';

const nodeTypes = {
  alu: ALUNode,
  register: RegisterFileNode,
  mux: MuxNode,
  'imm-gen': ImmGenNode,
  control: ControlNode,
  memory: DataMemoryNode,
  'instruction-memory': InstructionMemoryNode,
  'alu-control': ALUControlNode,
  pc: PCNode,
  constant: ConstantNode,
  'single-register': SingleRegisterNode,
  label: LabelNode,
  add: AddNode,
  fork: ForkNode,
  'instr-distributer': InstrDistributerNode,
  'jump-control': JumpControlNode,
};

// 定义必需的组件和它们允许的数量
const requiredComponents = {
  pc: { min: 1, max: 1 },
  alu: { min: 1, max: 1 },
  register: { min: 1, max: 1 },
  'instruction-memory': { min: 1, max: 1 },
  memory: { min: 1, max: 1 },
  control: { min: 1, max: 1 },
  'alu-control': { min: 1, max: 1 },
};

export function CircuitCanvas() {
  const {
    nodes,
    edges,
    addNode,
    addEdge,
    setSelectedNode,
    setSelectedEdge,
    selectedNode,
    selectedEdge,
    removeNode,
    removeEdge,
    isSimulating,
    toggleSimulation,
    resetSimulation,
    stepSimulation,
    updateNodes
  } = useCircuitStore();
  const [edgeType, setEdgeType] = useState('smoothstep');
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>(ConnectionMode.Loose);
  const [edgeAnimated, setEdgeAnimated] = useState(false);
  const [edgeColor, setEdgeColor] = useState('#999');
  const [edgeWidth, setEdgeWidth] = useState(3);
  const [showEdgeSettings, setShowEdgeSettings] = useState(false);
  const [simulationInterval, setSimulationInterval] = useState(1000);
  
  const validateCircuit = useCallback(() => {
    const errors: string[] = [];
    const componentCounts: { [key: string]: number } = {};

    // 统计各类组件数量
    nodes.forEach(node => {
      if (node.type) {
        componentCounts[node.type] = (componentCounts[node.type] || 0) + 1;
      }
    });

    // 检查必需组件
    Object.entries(requiredComponents).forEach(([type, { min, max }]) => {
      const count = componentCounts[type] || 0;
      if (count < min) {
        errors.push(`缺少必需组件: ${type}`);
      } else if (count > max) {
        errors.push(`${type} 组件数量过多，最多允许 ${max} 个`);
      }
    });

    // 检查连接
    const connectedNodes = new Set();
    edges.forEach(edge => {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    });

    nodes.forEach(node => {
      if (!connectedNodes.has(node.id)) {
        errors.push(`组件 ${node.type} (${node.id}) 未连接到任何其他组件`);
      }
    });

    // 显示验证结果
    if (errors.length === 0) {
      alert('数据通路验证通过！所有必需组件都已正确配置。');
    } else {
      alert('数据通路验证失败：\n' + errors.join('\n'));
    }
  }, [nodes, edges]);

  // Handle clicking on empty space
  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, [setSelectedNode, setSelectedEdge]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      const nextNodes = applyNodeChanges(changes, nodes);
      updateNodes(nextNodes);
    },
    [nodes, updateNodes]
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      const nextEdges = applyEdgeChanges(changes, edges);
      useCircuitStore.setState((state) => ({ edges: nextEdges }));
    },
    [edges]
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      setSelectedEdge(edge);
    },
    [setSelectedEdge]
  );
  const onConnect = useCallback(
    (params: Connection) => {
      const sourceNode = nodes.find(node => node.id === params.source);
      const targetNode = nodes.find(node => node.id === params.target);

      // 同步节点数据
      if (sourceNode && targetNode) {
        if (sourceNode.type === 'constant' && targetNode.type === 'label') {
          const sourceValue = sourceNode.data.value ?? 0;
          useCircuitStore.getState().updateNodeData(targetNode.id, {
            ...targetNode.data,
            value: sourceValue
          });
        }
      }

      const newEdge = {
        ...params,
        type: edgeType,
        animated: edgeAnimated,
        style: {
          stroke: edgeColor,
          strokeWidth: edgeWidth,
        },
        markerEnd: {
          type: 'arrow' as MarkerType,
          width: 20,
          height: 20,
          color: edgeColor,
        },
      };
      addEdge(newEdge);
    },
    [addEdge, edgeType, edgeAnimated, edgeColor, edgeWidth, nodes]
  );
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const position = {
        x: event.clientX - event.currentTarget.getBoundingClientRect().left,
        y: event.clientY - event.currentTarget.getBoundingClientRect().top,
      };

      const newNode = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: { label: type.toUpperCase() },
      };

      addNode(newNode);
    },
    [addNode]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node);
    },
    [setSelectedNode]
  );
  const edgeOptions = [
    { value: 'default', label: 'default' },
    { value: 'step', label: 'step' },
    { value: 'smoothstep', label: 'smoothstep' },
  ];
  const defaultEdgeOptions = {
    type: edgeType,
    animated: edgeAnimated,
    style: {
      stroke: edgeColor,
      strokeWidth: edgeWidth,
    },
    markerEnd: {
      type: 'arrow' as MarkerType,
      width: 20,
      height: 20,
      color: edgeColor,
    },
  };
  const connectionModeOptions = [
    { value: ConnectionMode.Strict, label: 'Strict' },
    { value: ConnectionMode.Loose, label: 'Loose' },
  ];
  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges.map(edge => ({
          ...edge,
          style: {
            ...defaultEdgeOptions.style,
            stroke: selectedEdge?.id === edge.id ? '#3b82f6' : edgeColor,
          },
          markerEnd: {
            type: 'arrow' as MarkerType,
            width: 20,
            height: 20,
            color: selectedEdge?.id === edge.id ? '#3b82f6' : edgeColor,
          }
        }))}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        nodesConnectable={true}
        nodesDraggable={true}
        edgesUpdatable={true}
        edgesFocusable={true}
        selectNodesOnDrag={false}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionMode={connectionMode}
        minZoom={0.2}
        maxZoom={3}
        fitView
      >
        <Background />
        <Controls />
        <Panel position="top-right" className="bg-white p-2 rounded-lg shadow-lg mr-4 mt-4">
          <div className="flex flex-col space-y-2">
            <div className="flex items-center justify-between mb-1">
              <button
                onClick={() => setShowEdgeSettings(!showEdgeSettings)}
                className="text-sm text-gray-600 hover:text-gray-900 flex items-center"
              >
                Setting {showEdgeSettings ? '▼' : '▶'}
              </button>
            </div>
            {showEdgeSettings && (
              <div className="space-y-2 p-2 bg-gray-50 rounded">
                <div className="flex flex-col space-y-1">
                  <label className="text-xs text-gray-600">连线类型</label>
                  <select
                    value={edgeType}
                    onChange={(e) => {
                      setEdgeType(e.target.value);
                      useCircuitStore.getState().updateEdgeType(e.target.value);
                    }}
                    className="px-2 py-1 rounded border border-gray-200 text-sm"
                  >
                    {edgeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="text-xs text-gray-600">连接模式</label>
                  <select
                    value={connectionMode}
                    onChange={(e) => {
                      setConnectionMode(e.target.value as ConnectionMode);
                      useCircuitStore.getState().updateConnectionMode(e.target.value as ConnectionMode);
                    }}
                    className="px-2 py-1 rounded border border-gray-200 text-sm"
                  >
                    {connectionModeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="text-xs text-gray-600">连线颜色</label>
                  <input
                    type="color"
                    value={edgeColor}
                    onChange={(e) => setEdgeColor(e.target.value)}
                    className="w-full h-6 rounded border border-gray-200"
                  />
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="text-xs text-gray-600">连线宽度</label>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={edgeWidth}
                    onChange={(e) => setEdgeWidth(parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={edgeAnimated}
                    onChange={(e) => {
                      setEdgeAnimated(e.target.checked);
                      useCircuitStore.getState().updateEdgeAnimated(e.target.checked);
                    }}
                    className="rounded border-gray-300"
                  />
                  <label className="text-xs text-gray-600">动画效果</label>
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="text-xs text-gray-600">模拟间隔 (ms)</label>
                  <input
                    type="range"
                    min="100"
                    max="5000"
                    step="100"
                    value={simulationInterval}
                    onChange={(e) => {
                      const newInterval = parseInt(e.target.value);
                      setSimulationInterval(newInterval);
                      useCircuitStore.getState().simulationInterval = newInterval;
                    }}
                    className="w-full"
                  />
                  <span className="text-xs text-gray-600">{simulationInterval}ms</span>
                </div>
              </div>
            )}
            <div className="flex space-x-2">
              <button
                onClick={validateCircuit}
                className="p-2 rounded hover:bg-gray-100 transition-colors"
                title="验证数据通路"
              >
                <CheckCircle className="w-5 h-5" />
              </button>
              <button
                onClick={() => {
                  if (selectedEdge) {
                    removeEdge(selectedEdge.id);
                    setSelectedEdge(null);
                  } else if (selectedNode) {
                    removeNode(selectedNode.id);
                    setSelectedNode(null);
                  }
                }}
                className="p-2 rounded hover:bg-gray-100 transition-colors"
                title="删除选中的组件或连线"
                disabled={!selectedEdge && !selectedNode}
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}