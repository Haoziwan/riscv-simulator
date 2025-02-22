import { Handle, Position, useNodes, useEdges } from 'reactflow';
import { useCircuitStore } from '../../store/circuitStore';
import React from 'react';

interface DataMemoryNodeData {
  label: string;
  address?: number;
  writeData?: number;
  memRead?: number;
  memWrite?: number;
  size?: number;
  readData?: number;
}

export function DataMemoryNode({ data, id, selected }: { data: DataMemoryNodeData; id: string; selected?: boolean }) {
  const memory = useCircuitStore((state) => state.memory);
  const updateMemory = useCircuitStore((state) => state.updateMemory);
  const updateNodeData = useCircuitStore((state) => state.updateNodeData);
  const stepCount = useCircuitStore((state) => state.stepCount);
  const nodes = useNodes();
  const edges = useEdges();

  const size = data.size || 1024; // 默认1KB

  // 监听输入连接的变化（组合逻辑部分：读取操作）
  React.useEffect(() => {
    // 找到连接到此节点的所有边
    const inputEdges = edges.filter(edge => edge.target === id);
    
    let newAddress = data.address || 0;
    let newMemRead = data.memRead || 0;
    let hasChanges = false;

    inputEdges.forEach(edge => {
      // 找到源节点
      const sourceNode = nodes.find(node => node.id === edge.source);
      if (sourceNode?.data && typeof sourceNode.data === 'object') {
        const portId = edge.targetHandle;
        let sourceValue: number | boolean | undefined;

        // 根据端口ID获取对应的值
        if (portId && sourceNode.data[portId as keyof typeof sourceNode.data] !== undefined) {
          sourceValue = sourceNode.data[portId as keyof typeof sourceNode.data] as number | boolean;
        } else if ('value' in sourceNode.data) {
          sourceValue = (sourceNode.data as { value?: number | boolean }).value;
        }

        // 根据端口类型更新对应的值
        if (sourceValue !== undefined) {
          switch (portId) {
            case 'address':
              if (typeof sourceValue === 'number' && sourceValue !== newAddress) {
                newAddress = sourceValue;
                hasChanges = true;
              }
              break;
            case 'memRead':
              if (typeof sourceValue === 'number' && sourceValue !== newMemRead) {
                newMemRead = sourceValue;
                hasChanges = true;
              }
              break;
          }
        }
      }
    });

    if (hasChanges) {
      // 更新节点数据（只更新读取相关的状态）
      const addressHex = `0x${newAddress.toString(16).padStart(8, '0')}`;
      const readData = newMemRead > 0 ? (memory[addressHex] || 0) : 0;

      updateNodeData(id, {
        ...data,
        address: newAddress,
        memRead: newMemRead,
        readData: readData
      });
    }
  }, [edges, id, nodes, memory]);

  // 监听时钟信号（时序逻辑部分：写入操作）
  React.useEffect(() => {
    // 找到连接到此节点的所有边
    const inputEdges = edges.filter(edge => edge.target === id);
    
    let newAddress = data.address || 0;
    let newWriteData = data.writeData || 0;
    let newMemWrite = data.memWrite || 0;
    let hasChanges = false;

    inputEdges.forEach(edge => {
      // 找到源节点
      const sourceNode = nodes.find(node => node.id === edge.source);
      if (sourceNode?.data && typeof sourceNode.data === 'object') {
        const portId = edge.targetHandle;
        let sourceValue: number | boolean | undefined;

        // 根据端口ID获取对应的值
        if (portId && sourceNode.data[portId as keyof typeof sourceNode.data] !== undefined) {
          sourceValue = sourceNode.data[portId as keyof typeof sourceNode.data] as number | boolean;
        } else if ('value' in sourceNode.data) {
          sourceValue = (sourceNode.data as { value?: number | boolean }).value;
        }

        // 根据端口类型更新对应的值
        if (sourceValue !== undefined) {
          switch (portId) {
            case 'writeData':
              if (typeof sourceValue === 'number' && sourceValue !== newWriteData) {
                newWriteData = sourceValue;
                hasChanges = true;
              }
              break;
            case 'memWrite':
              if (typeof sourceValue === 'number' && sourceValue !== newMemWrite) {
                newMemWrite = sourceValue;
                hasChanges = true;
              }
              break;
          }
        }
      }
    });

    if (hasChanges) {
      // 更新节点数据（写入相关的状态）
      const addressHex = `0x${newAddress.toString(16).padStart(8, '0')}`;

      // 写入数据
      if (newMemWrite > 0 && newWriteData !== memory[addressHex]) {
        updateMemory({
          [addressHex]: newWriteData
        });
      }

      // 更新节点状态
      updateNodeData(id, {
        ...data,
        writeData: newWriteData,
        memWrite: newMemWrite
      });
    }
  }, [stepCount]);

  return (
    <div className={`px-4 py-2 shadow-md rounded-md bg-white border-2 ${
      selected ? 'border-blue-500' : 'border-gray-200'
    }`}>
      {/* Control ports on left */}
      <Handle 
        type="target" 
        position={Position.Top} 
        id="memWrite" 
        className="w-3 h-3 bg-yellow-400" 
        style={{ left: '30%' }}
        title="写使能信号"
      />
      <Handle 
        type="target" 
        position={Position.Top} 
        id="memRead" 
        className="w-3 h-3 bg-yellow-400" 
        style={{ left: '70%' }}
        title="读使能信号"
      />
      <Handle 
        type="target" 
        position={Position.Left} 
        id="address" 
        className="w-3 h-3 bg-blue-400" 
        style={{ top: '30%' }}
        title="内存地址"
      />
      <Handle 
        type="target" 
        position={Position.Left} 
        id="writeData" 
        className="w-3 h-3 bg-blue-400" 
        style={{ top: '70%' }}
        title="写入数据"
      />

      {/* Output port on right */}
      <Handle 
        type="source" 
        position={Position.Right} 
        id="readData" 
        className="w-3 h-3 bg-green-400" 
        style={{ top: '50%' }}
        title="读出数据"
      />

      <div className="flex items-center">
        <div className="ml-2">
          <div className="text-lg font-bold">Data Memory</div>
          <div className="text-gray-500">Address: 0x{(data.address || 0).toString(16).padStart(8, '0')}</div>
          <div className="text-gray-500">Write Data: {data.writeData || 0}</div>
          <div className="text-gray-500">Read Data: {data.readData || 0}</div>
          <div className="text-gray-500">MemRead: {data.memRead || 0}</div>
          <div className="text-gray-500">MemWrite: {data.memWrite || 0}</div>
          <div className="text-xs text-gray-400 mt-2">
            Size: {size} bytes
          </div>
        </div>
      </div>
    </div>
  );
}