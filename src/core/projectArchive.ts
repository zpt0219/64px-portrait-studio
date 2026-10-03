import JSZip from 'jszip';
import { ProjectData } from '../types';
import { validateProjectData } from './projectData';

/**
 * 从 ZIP 归档文件中解包提取工程数据
 * @returns 经过合法性严格校验的 ProjectData
 */
export async function importProjectZip(file: Parameters<typeof JSZip.loadAsync>[0]): Promise<ProjectData> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (err) {
    throw new Error('无法读取 ZIP 文件，可能已损坏或非合法 ZIP 归档');
  }

  // 1. 优先读取根目录下的 imagegem_project.json
  let jsonFile = zip.file('imagegem_project.json');

  // 2. 容错搜索：若文件名有变动，查找任意以 .json 结尾的文件
  if (!jsonFile) {
    const jsonFiles = zip.file(/\.json$/i);
    if (jsonFiles && jsonFiles.length > 0) {
      jsonFile = jsonFiles[0];
    }
  }

  if (!jsonFile) {
    throw new Error('ZIP 归档中未找到工程配置文件 (imagegem_project.json)');
  }

  let jsonText: string;
  try {
    jsonText = await jsonFile.async('string');
  } catch (err) {
    throw new Error('读取工程 JSON 文件内容失败');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error('工程 JSON 配置文件解析失败：JSON 语法格式无效');
  }

  const validation = validateProjectData(parsed);
  if (!validation.valid || !validation.data) {
    throw new Error(validation.error || '工程数据校验失败');
  }

  return validation.data;
}
