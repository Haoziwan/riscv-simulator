export type Instruction = {
  type: 'R' | 'I' | 'S' | 'B' | 'U' | 'J';
  opcode: string;
  rd?: number;
  rs1?: number;
  rs2?: number;
  funct3?: string;
  funct7?: string;
  imm?: number;
};

export type AssembledInstruction = {
  hex: string;
  binary: string;
  assembly?: string;
  source?: string;
  segment?: 'text' | 'data';
  address?: number;
  data?: number[];
  originalLineNumber?: number;
};

export class AssemblerError extends Error {
  lineNumber?: number;
  instruction?: string;
  errorType: string;
  suggestion?: string;

  constructor(message: string, options?: {
    lineNumber?: number;
    instruction?: string;
    errorType?: string;
    suggestion?: string;
  }) {
    // Check if the message already includes a line number prefix to avoid duplication
    const hasLinePrefix = message.startsWith('Line');
    const formattedMessage = `${!hasLinePrefix && options?.lineNumber ? `Line ${options.lineNumber}: ` : ''}
${message}
${options?.instruction ? `Instruction: ${options.instruction}` : ''}
${options?.suggestion ? `Suggestion: ${options.suggestion}` : ''}`;
    super(formattedMessage);
    this.name = 'AssemblerError';
    this.lineNumber = options?.lineNumber;
    this.instruction = options?.instruction;
    this.errorType = options?.errorType || 'Syntax Error';
    this.suggestion = options?.suggestion;
  }
}

const registerAliases: Record<string, number> = {
  'zero': 0,
  'ra': 1,
  'sp': 2,
  'gp': 3,
  'tp': 4,
  't0': 5,
  't1': 6,
  't2': 7,
  's0': 8,
  'fp': 8,
  's1': 9,
  'a0': 10,
  'a1': 11,
  'a2': 12,
  'a3': 13,
  'a4': 14,
  'a5': 15,
  'a6': 16,
  'a7': 17,
  's2': 18,
  's3': 19,
  's4': 20,
  's5': 21,
  's6': 22,
  's7': 23,
  's8': 24,
  's9': 25,
  's10': 26,
  's11': 27,
  't3': 28,
  't4': 29,
  't5': 30,
  't6': 31
};

export const parseRegister = (reg: string): number => {
  // Try to match ABI name
  if (reg in registerAliases) {
    return registerAliases[reg];
  }

  // Try to match x+number format
  const match = reg.match(/x(\d+)/);
  if (!match) throw new AssemblerError(`Invalid register format: ${reg}`, {
    errorType: 'Register Error',
    suggestion: 'Registers should use x0-x31 format (e.g., x0, x1) or ABI names (e.g., zero, ra, sp, etc)'
  });
  const num = parseInt(match[1]);
  if (num < 0 || num > 31) throw new AssemblerError(`Register number must be between 0-31: ${reg}`, {
    errorType: 'Register Error',
    suggestion: 'Please check if the register number is within valid range (0-31)'
  });
  return num;
};

export const parseImmediate = (imm: string, bits: number): number => {
  let value: number;
  if (imm.startsWith('0x')) {
    value = parseInt(imm.slice(2), 16);
    // Handle hexadecimal negative numbers
    if (value >= (1 << (bits - 1))) {
      value -= (1 << bits);
    }
  } else {
    value = parseInt(imm);
  }
  const max = (1 << (bits - 1)) - 1;
  const min = -(1 << (bits - 1));
  if (isNaN(value)) {
    throw new AssemblerError(`Invalid immediate format: ${imm}`, {
    errorType: 'Immediate Error',
    suggestion: 'Immediate values can be in decimal (e.g., 42) or hexadecimal (e.g., 0xff) format'
  });
  }
  // Special handling for branch offset
  if (bits === 13 || bits === 21) {
    if (value % 2 !== 0) {
      throw new AssemblerError(`Branch/jump target must be 2-byte aligned: ${imm}`, {
    errorType: 'Alignment Error',
    suggestion: 'Branch and jump instruction targets must be multiples of 2'
  });
    }
    value = value >> 1; // Convert byte offset to word offset
  }
  if (value < min || value > max) {
    throw new AssemblerError(`Immediate must be between ${min} and ${max}: ${imm}`, {
    errorType: 'Immediate Range Error',
    suggestion: `Please ensure the immediate is within valid range (${min} to ${max})`
  });
  }
  return value;
};

export const expandPseudoInstruction = (line: string, lineNumber?: number): string[] => {
  // Remove comments
  const lineWithoutComment = line.split('#')[0].trim();
  const parts = lineWithoutComment.split(/[\s,]+/).filter(Boolean);
  const op = parts[0].toLowerCase();

  switch (op) {
    case 'li': {
      if (parts.length !== 3) {
        throw new AssemblerError(`Syntax error in li instruction: requires 2 operands\nCorrect format: li rd, immediate\n  - rd: target register (e.g., x1, t0)\n  - immediate: immediate value (e.g., 42, 0xff)\nCurrent input: ${lineWithoutComment}`, {
          lineNumber: lineNumber
        });
      }
      const rd = parts[1];
      let imm;
      try {
        imm = parts[2].startsWith('0x') ? parseInt(parts[2].slice(2), 16) : parseInt(parts[2]);
        if (isNaN(imm)) throw new Error();
      } catch {
        throw new AssemblerError(`Invalid immediate format in li instruction: ${parts[2]}\nSupported formats:\n  - Decimal number (e.g., 42)\n  - Hexadecimal number (e.g., 0xff)`, {
          lineNumber: lineNumber
        });
      }

      // 12位以内直接用addi
      if (imm >= -2048 && imm < 2048) {
        return [`addi ${rd}, x0, ${imm}`];
      } else {
        // 处理32位立即数，兼容负数
        let upper = (imm >> 12);
        let lower = imm & 0xFFF;
        // 处理负数addi的补码
        if (lower >= 0x800) {
          lower = lower - 0x1000;
          upper = upper + 1;
        }
        // 如果高20位为0且低12位为负数，直接addi
        if (upper === 0 && lower !== 0 && imm < 0) {
          return [`addi ${rd}, x0, ${lower}`];
        }
        // 如果低12位为0，只需lui
        if (lower === 0) {
          return [`lui ${rd}, ${upper}`];
        }
        return [
          `lui ${rd}, ${upper}`,
          `addi ${rd}, ${rd}, ${lower}`
        ];
      }
    }
    case 'la': {
      if (parts.length !== 3) throw new AssemblerError(`Syntax error in la instruction: requires 2 operands`, {
        errorType: 'Operand Error',
        instruction: lineWithoutComment,
        suggestion: 'la instruction format: la rd, symbol (e.g., la a0, msg)',
        lineNumber: lineNumber
      });

      // la rd, symbol - similar to li, expand to two instructions
      // during first pass, placeholder values are used because actual symbol address is unknown
      // during second pass, these will be filled with proper values
      const rd = parts[1];
      const symbol = parts[2];

      return [
        `lui ${rd}, %LA_HI_${symbol}%`,   // Placeholder for high 20 bits
        `addi ${rd}, ${rd}, %LA_LO_${symbol}%`  // Placeholder for low 12 bits
      ];
    }
    case 'mv': {
      if (parts.length !== 3) throw new AssemblerError('mv instruction requires 2 operands', {
        lineNumber: lineNumber
      });
      // mv rd, rs equivalent to addi rd, rs, 0
      return [`addi ${parts[1]}, ${parts[2]}, 0`];
    }
    case 'j': {
      if (parts.length !== 2) throw new AssemblerError('j instruction requires 1 operand', {
        lineNumber: lineNumber
      });
      // j offset equivalent to jal x0, offset
      return [`jal x0, ${parts[1]}`];
    }
    case 'call': {
      if (parts.length !== 2) throw new AssemblerError('call instruction requires 1 operand', {
        lineNumber: lineNumber,
        errorType: 'Operand Error',
        instruction: lineWithoutComment,
        suggestion: 'call instruction format: call label (e.g., call function_name)'
      });
      // call label equivalent to jal ra, label
      return [`jal ra, ${parts[1]}`];
    }
    case 'ret': {
      // ret equivalent to jalr x0, ra, 0
      return ['jalr x0, ra, 0'];
    }
    case 'nop': {
      // nop equivalent to addi x0, x0, 0
      return ['addi x0, x0, 0'];
    }
    default:
      return [lineWithoutComment];
  }
};

export const parseInstruction = (line: string, currentAddress: number, labelMap: Record<string, number>, lineNumber?: number): Instruction => {
  // Remove comments
  const lineWithoutComment = line.split('#')[0].trim();
  // Split instruction parts
  const parts = lineWithoutComment.split(/[\s,]+/).filter(Boolean);
  const op = parts[0].toLowerCase();

  switch (op) {
    case 'add':
    case 'sub':
    case 'and':
    case 'or':
    case 'xor':
    case 'sll':
    case 'srl':
    case 'sra':
    case 'slt':
    case 'sltu':
    // M extension instructions
    case 'mul':
    case 'mulh':
    case 'mulhsu':
    case 'mulhu':
    case 'div':
    case 'divu':
    case 'rem':
    case 'remu': {
      if (parts.length !== 4) throw new AssemblerError(`${op} instruction requires 3 operands`, {
        errorType: 'Operand Error',
        instruction: lineWithoutComment,
        suggestion: `${op} instruction format: ${op} rd, rs1, rs2 (e.g., ${op} x1, x2, x3)`,
        lineNumber: lineNumber
      });
      return {
        type: 'R',
        opcode: '0110011',
        rd: parseRegister(parts[1]),
        rs1: parseRegister(parts[2]),
        rs2: parseRegister(parts[3]),
        funct3: op === 'add' || op === 'sub' || op === 'mul' ? '000' :
               op === 'sll' || op === 'mulh' ? '001' :
               op === 'slt' || op === 'mulhsu' ? '010' :
               op === 'sltu' || op === 'mulhu' ? '011' :
               op === 'xor' || op === 'div' ? '100' :
               op === 'srl' || op === 'sra' || op === 'divu' ? '101' :
               op === 'or' || op === 'rem' ? '110' : '111',
        funct7: op === 'mul' || op === 'mulh' || op === 'mulhsu' || op === 'mulhu' ||
                op === 'div' || op === 'divu' || op === 'rem' || op === 'remu' ? '0000001' :
                op === 'sub' || op === 'sra' ? '0100000' : '0000000'
      };
    }
    case 'addi':
    case 'andi':
    case 'ori':
    case 'xori':
    case 'slti':
    case 'sltiu':
    case 'slli':
    case 'srli':
    case 'srai': {
      if (parts.length !== 4) throw new AssemblerError(`${op} instruction requires 3 operands`, {
    errorType: 'Operand Error',
    instruction: lineWithoutComment,
    suggestion: `${op} instruction format: ${op} rd, rs1, imm (e.g., ${op} x1, x2, 10)`
  });
      return {
        type: 'I',
        opcode: '0010011',
        rd: parseRegister(parts[1]),
        rs1: parseRegister(parts[2]),
        imm: parseImmediate(parts[3], 12),
        funct3: op === 'addi' ? '000' :
               op === 'slli' ? '001' :
               op === 'slti' ? '010' :
               op === 'sltiu' ? '011' :
               op === 'xori' ? '100' :
               op === 'srli' || op === 'srai' ? '101' :
               op === 'ori' ? '110' : '111',
        funct7: op === 'srai' ? '0100000' : op === 'slli' || op === 'srli' ? '0000000' : undefined
      };
    }
    case 'lb':
    case 'lh':
    case 'lw':
    case 'lbu':
    case 'lhu': {
      if (parts.length !== 3) throw new AssemblerError(`${op} instruction requires 2 operands with offset`);
      const [rd, memStr] = parts.slice(1);
      const match = memStr.match(/(-?\d+)\(([a-zA-Z0-9]+)\)/);
      if (!match) throw new AssemblerError(`Invalid memory access format: ${memStr}`, {
    errorType: 'Memory Access Format Error',
    instruction: lineWithoutComment,
    suggestion: 'Memory access format should be: offset(register), e.g., 4(x2) or 4(sp)'
  });
      return {
        type: 'I',
        opcode: '0000011',
        rd: parseRegister(rd),
        rs1: parseRegister(match[2]),
        imm: parseImmediate(match[1], 12),
        funct3: op === 'lb' ? '000' :
               op === 'lh' ? '001' :
               op === 'lw' ? '010' :
               op === 'lbu' ? '100' : '101'
      };
    }
    case 'sb':
    case 'sh':
    case 'sw': {
      if (parts.length !== 3) throw new AssemblerError(`${op} instruction requires 2 operands with offset`);
      const [rs2, memStr] = parts.slice(1);
      const match = memStr.match(/(-?\d+)\(([a-zA-Z0-9]+)\)/);
      if (!match) throw new AssemblerError(`Invalid memory access format: ${memStr}`, {
    errorType: 'Memory Access Format Error',
    instruction: lineWithoutComment,
    suggestion: 'Memory access format should be: offset(register), e.g., 4(x2) or 4(sp)'
  });
      return {
        type: 'S',
        opcode: '0100011',
        rs1: parseRegister(match[2]),
        rs2: parseRegister(rs2),
        imm: parseImmediate(match[1], 12),
        funct3: op === 'sb' ? '000' :
               op === 'sh' ? '001' : '010'
      };
    }
    case 'beq':
    case 'bne':
    case 'blt':
    case 'bge':
    case 'bltu':
    case 'bgeu': {
      if (parts.length !== 4) throw new AssemblerError(`${op} instruction requires 3 operands`, {
    errorType: 'Operand Error',
    instruction: lineWithoutComment,
    suggestion: `${op} instruction format: ${op} rs1, rs2, offset/label (e.g., ${op} x1, x2, label)`
  });
      const targetLabel = parts[3];
      let offset: number;

      if (targetLabel in labelMap) {
        offset = labelMap[targetLabel] - currentAddress;
      } else {
        offset = parseImmediate(targetLabel, 13);
      }

      return {
        type: 'B',
        opcode: '1100011',
        rs1: parseRegister(parts[1]),
        rs2: parseRegister(parts[2]),
        imm: offset,
        funct3: op === 'beq' ? '000' :
               op === 'bne' ? '001' :
               op === 'blt' ? '100' :
               op === 'bge' ? '101' :
               op === 'bltu' ? '110' : '111'
      };
    }
    case 'lui':
    case 'auipc': {
      if (parts.length !== 3) throw new AssemblerError(`${op} instruction requires 2 operands`);
      return {
        type: 'U',
        opcode: op === 'lui' ? '0110111' : '0010111',
        rd: parseRegister(parts[1]),
        imm: parseImmediate(parts[2], 20)
      };
    }
    case 'jal': {
      if (parts.length !== 3) throw new AssemblerError(`${op} instruction requires 2 operands`);
      const targetLabel = parts[2];
      let offset: number;

      if (targetLabel in labelMap) {
        offset = labelMap[targetLabel] - currentAddress;
      } else {
        offset = parseImmediate(targetLabel, 21);
      }

      return {
        type: 'J',
        opcode: '1101111',
        rd: parseRegister(parts[1]),
        imm: offset
      };
    }
    case 'jalr': {
      if (parts.length !== 4) throw new AssemblerError(`${op} instruction requires 3 operands`, {
    errorType: 'Operand Error',
    instruction: lineWithoutComment,
    suggestion: `${op} instruction format: ${op} rd, rs1, imm (e.g., ${op} x1, x2, 0)`
  });
      return {
        type: 'I',
        opcode: '1100111',
        rd: parseRegister(parts[1]),
        rs1: parseRegister(parts[2]),
        imm: parseImmediate(parts[3], 12),
        funct3: '000'
      };
    }
    case 'ecall': {
      if (parts.length !== 1) throw new AssemblerError(`${op} instruction does not require operands`, {
        errorType: 'Operand Error',
        instruction: lineWithoutComment,
        suggestion: 'ecall instruction format: ecall'
      });
      return {
        type: 'I',
        opcode: '1110011',
        rd: 0,
        rs1: 0,
        imm: 0,
        funct3: '000'
      };
    }
    default:
      throw new AssemblerError(`Unsupported instruction: ${op}`, {
    errorType: 'Unknown Instruction',
    instruction: lineWithoutComment,
    suggestion: 'Please check if the instruction spelling is correct, or refer to the list of supported instructions'
  });
  }
};

export const generateMachineCode = (inst: Instruction): string => {
  let machineCode = parseInt(inst.opcode, 2);

  // Sign extension function
  const signExtend = (value: number, bits: number) => {
    // Check if the most significant bit is 1 (negative)
    const signBit = 1 << (bits - 1);
    if (value & signBit) {
      // If negative, perform sign extension
      return value | (~0 << bits);
    } else {
      // If positive, keep unchanged
      return value;
    }
  };

  switch (inst.type) {
    case 'R':
      machineCode = parseInt(inst.opcode, 2) & 0x7F;
      machineCode |= (inst.rd! & 0x1F) << 7;
      machineCode |= (parseInt(inst.funct3!, 2) & 0x7) << 12;
      machineCode |= (inst.rs1! & 0x1F) << 15;
      machineCode |= (inst.rs2! & 0x1F) << 20;
      machineCode |= (parseInt(inst.funct7!, 2) & 0x7F) << 25;
      break;

    case 'I':
      // Directly use the original immediate value, no sign extension
      const iImm = inst.imm!;

      machineCode |= (inst.rd! & 0x1F) << 7;
      machineCode |= (parseInt(inst.funct3!, 2) & 0x7) << 12;
      machineCode |= (inst.rs1! & 0x1F) << 15;

      // For shift instructions (slli, srli, srai), need special handling for funct7 field
      if (inst.funct7) {
        machineCode |= (parseInt(inst.funct7, 2) & 0x7F) << 25;
        // For shift instructions, immediate only use low 5 bits
        machineCode |= ((iImm & 0x1F) << 20) >>> 0;
      } else {
        // For other I-type instructions, use low 12 bits
        machineCode |= ((iImm & 0xFFF) << 20) >>> 0;
      }

      break;

    case 'S':
      const sImm = signExtend(inst.imm!, 12);
      machineCode |= ((sImm & 0x1F) << 7);
      machineCode |= (parseInt(inst.funct3!, 2) & 0x7) << 12;
      machineCode |= (inst.rs1! & 0x1F) << 15;
      machineCode |= (inst.rs2! & 0x1F) << 20;
      machineCode |= ((sImm >> 5) << 25);
      break;

    case 'B':
      const bImm = signExtend(inst.imm!, 13); // No need to left shift 1

      machineCode |= ((bImm & 0x1000) >> 12) << 31; // imm[12] -> bit 31
      machineCode |= ((bImm & 0x7E0) >> 5) << 25;   // imm[10:5] -> bits 30:25
      machineCode |= ((bImm & 0x1E) >> 1) << 8;     // imm[4:1] -> bits 11:8
      machineCode |= ((bImm & 0x800) >> 11) << 7;   // imm[11] -> bit 7

      machineCode |= (parseInt(inst.funct3!, 2) & 0x7) << 12; // funct3 -> bits 14:12
      machineCode |= (inst.rs1! & 0x1F) << 15; // rs1 -> bits 19:15
      machineCode |= (inst.rs2! & 0x1F) << 20; // rs2 -> bits 24:20

      // machineCode |= 0b1100011; // B type instruction opcode

      break;


    case 'U':
      machineCode |= (inst.rd! & 0x1F) << 7;
      machineCode |= ((inst.imm! & 0xFFFFF) << 12);
      break;

    case 'J':
      const jImm = signExtend(inst.imm!, 21); // Immediate extend to 21 bits

      machineCode |= ((jImm & 0x100000) >> 20) << 31; // imm[20] -> bit 31
      machineCode |= ((jImm & 0xFF000) >> 12) << 12;  // imm[19:12] -> bits 19:12
      machineCode |= ((jImm & 0x800) >> 11) << 20;    // imm[11] -> bit 20
      machineCode |= ((jImm & 0x7FE) >> 1) << 21;     // imm[10:1] -> bits 30:21

      machineCode |= (inst.rd! & 0x1F) << 7; // rd -> bits 11:7
      machineCode |= 0b1101111; // JAL opcode

      break;

  }

  // Ensure return is unsigned 32-bit integer hexadecimal representation
  return `0x${(machineCode >>> 0).toString(16).padStart(8, '0')}`;
};

export class Assembler {
  private labelMap: Record<string, number> = {};
  private currentAddress = 0;
  private currentSegment: 'text' | 'data' = 'text';
  private textAddress = 0;
  private dataAddress = 0;
  private readonly GP_BASE = 0x10000000;  // GP register base address

  public getLabelMap(): Record<string, number> {
    return this.labelMap;
  }

  public assemble(code: string): AssembledInstruction[] {
    this.labelMap = {};
    this.currentAddress = 0;
    this.currentSegment = 'text';
    this.textAddress = 0;
    this.dataAddress = this.GP_BASE; // Data segment starts from GP register base address

    // First pass: Collect addresses of labels and instructions, but not data addresses
    // Preprocess labels separately
    let currentAddr = 0;
    let inDataSegment = false;

    // First separate all lines and save them (ignoring comments and empty lines)
    const allLines: {text: string, hasLabel: boolean, label?: string, instr?: string, lineNumber: number}[] = [];

    code.split('\n').forEach((line, index) => {
      const lineNumber = index + 1; // 1-indexed line numbers
      const trimmedLine = line.split('#')[0].trim(); // Remove comments before trimming
      if (!trimmedLine) return;

      const entry: {text: string, hasLabel: boolean, label?: string, instr?: string, lineNumber: number} = {
        text: trimmedLine,
        hasLabel: false,
        lineNumber: lineNumber
      };

      // Check for label
      const labelMatch = trimmedLine.match(/^([a-zA-Z0-9_]+):/);
      if (labelMatch) {
        entry.hasLabel = true;
        entry.label = labelMatch[1];

        // Extract instruction or data after label
        const afterLabel = trimmedLine.substring(labelMatch[0].length).trim();
        if (afterLabel) {
          entry.instr = afterLabel;
        }
      } else {
        entry.instr = trimmedLine;
      }

      allLines.push(entry);
    });

    // Now perform first pass traversal, collect .text and .data instruction and label locations
    currentAddr = 0;
    inDataSegment = false;

    for (let i = 0; i < allLines.length; i++) {
      const entry = allLines[i];

      // Process segment instructions
      if (entry.instr === '.text') {
        inDataSegment = false;
        currentAddr = 0; // Code segment starts from 0
        continue;
      } else if (entry.instr === '.data') {
        inDataSegment = true;
        currentAddr = this.GP_BASE; // Data segment starts from GP_BASE
        continue;
      }

      // If there is a label, record its address
      if (entry.hasLabel) {
        this.labelMap[entry.label!] = currentAddr;
      }

      // Update address based on instruction or data type
      if (entry.instr) {
        // Skip directive instructions like .globl that don't generate code
        if (entry.instr.startsWith('.globl')) {
          continue;
        }

        if (!inDataSegment) {
          // Process code segment
          try {
            const expandedInstrs = expandPseudoInstruction(entry.instr, entry.lineNumber);
            currentAddr += 4 * expandedInstrs.length;
          } catch (error: unknown) {
            if (error instanceof AssemblerError) {
              // Propagate the error with line number
              throw new AssemblerError(error.message, {
                ...error,
                lineNumber: entry.lineNumber
              });
            } else {
              throw new AssemblerError(`Error processing instruction: ${error instanceof Error ? error.message : String(error)}`, {
                lineNumber: entry.lineNumber,
                instruction: entry.instr
              });
            }
          }
        } else {
          // Process data segment
          if (entry.instr.startsWith('.word')) {
            const parts = entry.instr.split(/\s+/).slice(1);
            currentAddr += 4 * parts.length;
          } else if (entry.instr.startsWith('.byte')) {
            const parts = entry.instr.split(/\s+/).slice(1);
            currentAddr += parts.length;
          } else if (entry.instr.startsWith('.half')) {
            const parts = entry.instr.split(/\s+/).slice(1);
            currentAddr += 2 * parts.length;
          } else if (entry.instr.startsWith('.ascii') || entry.instr.startsWith('.asciz')) {
            const match = entry.instr.match(/"(.*)"/);
            if (match) {
              const str = match[1];
              const increment = entry.instr.startsWith('.asciz') ? str.length + 1 : str.length;
              currentAddr += increment;
            }
          }
        }
      }
    }

    // After label collection, start second pass for actual assembly
    this.currentAddress = 0;
    this.currentSegment = 'text';

    const result: AssembledInstruction[] = [];
    const memoryBytes: Record<number, number> = {}; // Used to track each byte in memory

    // Second pass: Generate actual instructions and data
    let currentSection = 'text';

    for (const entry of allLines) {
      // Process segment instructions
      if (entry.instr === '.text') {
        currentSection = 'text';
        this.currentAddress = result.filter(inst => inst.segment === 'text').reduce((acc, inst) => acc + 4, 0);
        continue;
      } else if (entry.instr === '.data') {
        currentSection = 'data';
        this.currentAddress = this.GP_BASE + result.filter(inst => inst.segment === 'data').reduce((acc, inst) => {
          if (inst.data) {
            return acc + inst.data.length;
          }
          return acc;
        }, 0);
        continue;
      }

      // Skip pure label lines
      if (!entry.instr) continue;

      const instruction = entry.instr;

      // Skip directive instructions like .globl that don't generate code
      if (instruction.startsWith('.globl')) {
        continue;
      }

      if (currentSection === 'text') {
        // Process code segment instructions
        if (!instruction.startsWith('.')) {
          // Expand pseudo instructions
          try {
            const expandedInstructions = expandPseudoInstruction(instruction, entry.lineNumber);
            expandedInstructions.forEach((expandedLine, i) => {
              try {
                // Process placeholders for la instruction
                if (expandedLine.includes('%LA_HI_') || expandedLine.includes('%LA_LO_')) {
                  // Extract symbol name from placeholder
                  const match = expandedLine.match(/%LA_(HI|LO)_([a-zA-Z0-9_]+)%/);
                  if (match) {
                    const type = match[1]; // HI or LO
                    const symbol = match[2];

                    if (!(symbol in this.labelMap)) {
                      throw new AssemblerError(`Undefined label: ${symbol}`, {
                        errorType: 'Label Error',
                        instruction: expandedLine,
                        suggestion: 'Please ensure the label is defined in the code',
                        lineNumber: entry.lineNumber
                      });
                    }

                    const address = this.labelMap[symbol];

                    if (type === 'HI') {
                      // For lui instruction, calculate upper 20 bits
                      const baseImm = address >= this.GP_BASE ?
                        0x10000 : // For data segment
                        (address >>> 12); // For code segment

                      const luiParts = expandedLine.split(/[\s,]+/).filter(Boolean);
                      const rd = luiParts[1];

                      // Generate lui instruction with proper immediate
                      const luiInst = {
                        type: 'U' as const,
                        opcode: '0110111',
                        rd: parseRegister(rd),
                        imm: baseImm
                      };

                      const luiHex = generateMachineCode(luiInst);
                      const luiBinary = (parseInt(luiHex.slice(2), 16) >>> 0).toString(2).padStart(32, '0');

                      // Add to result
                      result.push({
                        hex: luiHex,
                        binary: luiBinary,
                        assembly: `lui ${rd}, 0x${baseImm.toString(16)}`,
                        source: entry.text,
                        segment: 'text',
                        address: this.currentAddress,
                        originalLineNumber: entry.lineNumber
                      });

                    } else if (type === 'LO') {
                      // For addi instruction, calculate lower 12 bits
                      let offset = address >= this.GP_BASE ?
                        (address - this.GP_BASE) : // For data segment
                        (address & 0xFFF); // For code segment

                      const addiParts = expandedLine.split(/[\s,]+/).filter(Boolean);
                      const rd = addiParts[1];
                      const rs1 = addiParts[2];

                      // Ensure offset is within 12-bit signed integer range
                      if (offset < -2048 || offset > 2047) {
                        console.warn(`Warning: ${symbol} offset ${offset} exceeds 12-bit signed integer range`);
                      }

                      // Generate addi instruction
                      const addiInst = {
                        type: 'I' as const,
                        opcode: '0010011',
                        rd: parseRegister(rd),
                        rs1: parseRegister(rs1),
                        imm: offset,
                        funct3: '000'
                      };

                      const addiHex = generateMachineCode(addiInst);
                      const addiBinary = (parseInt(addiHex.slice(2), 16) >>> 0).toString(2).padStart(32, '0');

                      // Add to result
                      result.push({
                        hex: addiHex,
                        binary: addiBinary,
                        assembly: `addi ${rd}, ${rs1}, ${offset}`,
                        source: entry.text,
                        segment: 'text',
                        address: this.currentAddress,
                        originalLineNumber: entry.lineNumber
                      });
                    }

                    this.currentAddress += 4;
                    return; // Placeholder processed, skip normal processing
                  }
                }

                // Process other instructions
                const parsedInst = parseInstruction(expandedLine, this.currentAddress, this.labelMap, entry.lineNumber);
                const hex = generateMachineCode(parsedInst);
                const binary = (parseInt(hex.slice(2), 16) >>> 0).toString(2).padStart(32, '0');
                result.push({
                  hex,
                  binary,
                  assembly: expandedLine,
                  source: entry.text,
                  segment: 'text',
                  address: this.currentAddress,
                  originalLineNumber: entry.lineNumber
                });
                this.currentAddress += 4;
              } catch (error: unknown) {
                if (error instanceof AssemblerError) {
                  throw new AssemblerError(error.message, {
                    ...error,
                    lineNumber: entry.lineNumber
                  });
                } else {
                  throw new AssemblerError(`Error processing instruction: ${error instanceof Error ? error.message : String(error)}`, {
                    lineNumber: entry.lineNumber,
                    instruction: expandedLine
                  });
                }
              }
            });
          } catch (error: unknown) {
            if (error instanceof AssemblerError) {
              throw error; // Line number already set
            } else {
              throw new AssemblerError(`Error processing instruction: ${error instanceof Error ? error.message : String(error)}`, {
                lineNumber: entry.lineNumber,
                instruction: instruction
              });
            }
          }
        }
      } else if (currentSection === 'data') {
        // Process data segment instructions
        try {
          let dataBytes: number[] = [];
          let dataSize = 0;

          if (instruction.startsWith('.word')) {
            const parts = instruction.split(/[\s,]+/).slice(1);
            const data = parts.map(part => {
              if (part.startsWith('0x')) {
                return parseInt(part.slice(2), 16);
              } else {
                return parseInt(part);
              }
            });

            dataBytes = [];
            // Store as little-endian
            data.forEach(value => {
              dataBytes.push(value & 0xFF);
              dataBytes.push((value >> 8) & 0xFF);
              dataBytes.push((value >> 16) & 0xFF);
              dataBytes.push((value >> 24) & 0xFF);
            });
            dataSize = 4 * data.length;

            // Store each word in memory
            data.forEach((value, index) => {
              const addr = this.currentAddress + (index * 4);
              memoryBytes[addr] = value & 0xFF;
              memoryBytes[addr + 1] = (value >> 8) & 0xFF;
              memoryBytes[addr + 2] = (value >> 16) & 0xFF;
              memoryBytes[addr + 3] = (value >> 24) & 0xFF;
            });

            // Add to result array
            result.push({
              hex: '0x' + data.map(d => d.toString(16).padStart(8, '0')).join(''),
              binary: data.map(d => d.toString(2).padStart(32, '0')).join(''),
              assembly: instruction,
              source: entry.text,
              segment: 'data',
              address: this.currentAddress,
              data: data,
              originalLineNumber: entry.lineNumber
            });

            // Store each word in memory
            data.forEach((value, index) => {
              const addr = this.currentAddress + (index * 4);
              memoryBytes[addr] = value & 0xFF;
              memoryBytes[addr + 1] = (value >> 8) & 0xFF;
              memoryBytes[addr + 2] = (value >> 16) & 0xFF;
              memoryBytes[addr + 3] = (value >> 24) & 0xFF;
            });

          } else if (instruction.startsWith('.byte')) {
            const parts = instruction.split(/[\s,]+/).slice(1);
            const data = parts.map(part => {
              if (part.startsWith('0x')) {
                return parseInt(part.slice(2), 16) & 0xFF;
              } else if (part.startsWith('\'') && part.endsWith('\'') && part.length === 3) {
                return part.charCodeAt(1) & 0xFF;
              } else {
                return parseInt(part) & 0xFF;
              }
            });

            // Store each byte in memory
            data.forEach((value, index) => {
              memoryBytes[this.currentAddress + index] = value;
            });

            dataBytes = data;
            dataSize = data.length;

            result.push({
              hex: '0x' + data.map(d => d.toString(16).padStart(2, '0')).join(''),
              binary: data.map(d => d.toString(2).padStart(8, '0')).join(''),
              assembly: instruction,
              source: entry.text,
              segment: 'data',
              address: this.currentAddress,
              data: data,
              originalLineNumber: entry.lineNumber
            });

          } else if (instruction.startsWith('.half')) {
            const parts = instruction.split(/[\s,]+/).slice(1);
            const data = parts.map(part => {
              if (part.startsWith('0x')) {
                return parseInt(part.slice(2), 16) & 0xFFFF;
              } else {
                return parseInt(part) & 0xFFFF;
              }
            });

            // Store each half word in memory
            data.forEach((value, index) => {
              const addr = this.currentAddress + (index * 2);
              memoryBytes[addr] = value & 0xFF;
              memoryBytes[addr + 1] = (value >> 8) & 0xFF;
            });

            dataBytes = [];
            // Store as little-endian
            data.forEach(value => {
              dataBytes.push(value & 0xFF);
              dataBytes.push((value >> 8) & 0xFF);
            });
            dataSize = 2 * data.length;

            result.push({
              hex: '0x' + data.map(d => d.toString(16).padStart(4, '0')).join(''),
              binary: data.map(d => d.toString(2).padStart(16, '0')).join(''),
              assembly: instruction,
              source: entry.text,
              segment: 'data',
              address: this.currentAddress,
              data: data,
              originalLineNumber: entry.lineNumber
            });

          } else if (instruction.startsWith('.ascii') || instruction.startsWith('.asciz')) {
            const match = instruction.match(/"(.*)"/);
            if (match) {
              const str = match[1];
              const data = Array.from(str).map(c => c.charCodeAt(0));

              if (instruction.startsWith('.asciz')) {
                data.push(0); // Add null character at the end
              }

              dataBytes = data;
              dataSize = data.length;

              result.push({
                hex: '0x' + data.map(d => d.toString(16).padStart(2, '0')).join(''),
                binary: data.map(d => d.toString(2).padStart(8, '0')).join(''),
                assembly: instruction,
                source: entry.text,
                segment: 'data',
                address: this.currentAddress,
                data: data,
                originalLineNumber: entry.lineNumber
              });
            }
          }

          // Store to memory model and update address
          if (dataBytes.length > 0) {
            dataBytes.forEach((value, i) => {
              memoryBytes[this.currentAddress + i] = value;
            });

            this.currentAddress += dataSize;
          }
        } catch (error: unknown) {
          if (error instanceof AssemblerError) {
            throw new AssemblerError(error.message, {
              ...error,
              lineNumber: entry.lineNumber
            });
          } else {
            throw new AssemblerError(`Error processing data: ${error instanceof Error ? error.message : String(error)}`, {
              lineNumber: entry.lineNumber,
              instruction: instruction
            });
          }
        }
      }
    }

    // Add memory data to result
    // As a special attribute added to the first result element
    if (result.length > 0) {
      const memoryData: Record<string, number> = {};
      Object.entries(memoryBytes).forEach(([addr, value]) => {
        memoryData[`0x${parseInt(addr).toString(16).padStart(8, '0')}`] = value;
      });

      // @ts-ignore - Add a special attribute for passing memory data
      result[0].memoryData = memoryData;
    }

    return result;
  }
}