---
title: "XV6-2020: LAB9-FILESYSTEM"
published: 2025-07-21
description: "今天是什么日子呢（笑）"
image: "./lab9.jpg"
tags: ["xv6"]
category: OS
draft: false
---

# 前言
这个lab能学到的东西还挺多的，算是一个很好的文件系统入门了。     

# large files (moderate)
第一个小作业是要给xv6现有的fs添加一个二级索引，我们先说说原本的是怎么样的吧。       
> [0 - 11] 直接索引 | [12] 一级索引
然后我们要改成这样：        
> [0 - 10] 直接索引 | [11] 一级索引 | [12] 二级索引

直接索引：
- 存储指向块的地址
- 能直接找到数据，不需要在跳转

一级索引：
- 存储地址，指向一个**「索引块」**
- 索引块里有**256个**数据块地址

二级索引：
- 存储地址，指向一个**「集合块」**
- 集合块存储着**256个「一级索引块」**
- 每个一级索引块能存储**256个**数据块地址
- 所以一个二级索引最多能存储**256×256个**块，也就是**65536个**

差不多是这样：      
> 一级索引 -> 256个块地址       
> 二级索引 -> 256个一级索引地址 -> (256*256)个块地址        

如果算总空间的话...一开始是256+12，也就是268×1024，274,432B、**268kB**，说实话好像有点小。    
现在的话，是(11)+(256)+(256×256)，也就是65,804kB、**64mB**，那确实挺多的了。    

声明：如果在其他地方看到了其他术语，那就默认博主（我）的是错的，因为这些术语我没怎么查过，临时自创的。   

## 修改inode结构
根据xv6的提示，我们需要把`NDIRECT`改为**11**，因为之前的其中一个要用来放**二级索引**：
```C
#define NDIRECT 11 // 直接块
#define DINDIRECT (NDIRECT + 1) // 二级索引
#define NINDIRECT (BSIZE / sizeof(uint)) // 一级索引能存的地址量
#define MAXFILE (NDIRECT + NINDIRECT + (NINDIRECT * NINDIRECT)) // 一个进程最多能持有的文件缓存块数
```

然后`inode`结构体的`addrs`字段就要改为**直接块（0-10）、一级索引（11）、二级索引（12）**：
```C
struct dinode {
  short type;               // File type
  short major;              // Major device number (T_DEVICE only)
  short minor;              // Minor device number (T_DEVICE only)
  short nlink;              // Number of links to inode in file system
  uint size;                // Size of file (bytes)
  uint addrs[NDIRECT+2];    // Data block addresses
};
```

## 修改bmap函数
这个函数的作用是：    
返回：在实参inode结构体中，对应块号的地址   
如果没有这个块号的地址，那就创建一个。

### 修改前
这个函数有点难，所以我们慢慢看。    
首先，第一段：
```C
// 直接块处理方法
if(bn < NDIRECT){ 
    if((addr = ip->addrs[bn]) == 0) 
      ip->addrs[bn] = addr = balloc(ip->dev);  
    return addr;
  }
```
代码作用：    
1. 如果bn下标还没被占用，那就分配一个空闲块号。    
2. 如果里面已经有地址了，那直接赋值给addr，然后这函数基本就完工了。

其次，第二段：
```C
// 这个很重要的，注意
// 没有这个的话那你块号是255之类的就完啦！
// 或者其他合法但是在这里过大的索引
// 不是错位就是爆炸！
bn -= NDIRECT;

// 一级索引处理方法
if(bn < NINDIRECT){
    if((addr = ip->addrs[NDIRECT]) == 0)
      ip->addrs[NDIRECT] = addr = balloc(ip->dev);
    bp = bread(ip->dev, addr);
    a = (uint*)bp->data;
    if((addr = a[bn]) == 0){
      a[bn] = addr = balloc(ip->dev);
      log_write(bp);
    }
    brelse(bp);
    return addr;
  }

  panic("bmap: out of range");
```
代码作用：    
1. 如果索引块还没创建，那就分配一个索引块
2. 获取该数据块的缓存
3. 对该缓存块的`data`字段进行类型转换并赋值给`a`    
> `uchar data[1024]`在转换后，就会变成`uint*[256]`了    
> 你可能会疑惑“啊？为什么不是**128**呢？**1024/8**是**128**呀！   
> 但是其实这里是用`uint`本身的大小转换的呢，很神奇吧，就是**4字节**！   
> 反正就是这样，明白不是用指针大小转换就行了！    

4. 如果在这个256个地址的索引块数组内没有对应bn的地址，那就分配一块空闲的
> 然后这里还要调用`log_write()`，具体原因博主不是很清楚，
似乎是因为索引块并不是直接属于inode的，所以就得调用   
> 别忘了调用`brelse()`释放锁，因为`bread()`会调用`bget()`，这过程会让对应的块缓存被锁，
所以一定得释放锁，毕竟我们已经好了
5. 如果啥事没有的话，就直接给用户返回addr

### 修改后
基本照葫芦画瓢就可以做出一个**二级索引VER**了呢！   
```C
bn -= NINDIRECT;

if(bn < NINDIRECT * NINDIRECT){ // 只要在65535范围内的就都是合法bn
  dbn = bn / NINDIRECT; // 在哪个一级索引块？
  dbnoff = bn % NINDIRECT; // 在该块的第几个索引？

  if((addr = ip->addrs[DINDIRECT]) == 0)
    ip->addrs[DINDIRECT] = addr = balloc(ip->dev);

  // 和刚刚的一样，不过读者可以把它想得更简单点
  // 想成“进入该块”就可以了，这次我们进入的是集合块
  bp = bread(ip->dev, addr);
  a = (uint*)bp->data;
    
  // 在集合块内有没有对应的一级索引块？
  if((addr2 = a[dbn]) == 0){
    a[dbn] = addr2 = balloc(ip->dev);
    log_write(bp);
  }
  brelse(bp);

  // 这次进入的是对应的一级索引块
  bp2 = bread(ip->dev, addr2);
  a2 = (uint*)bp2->data;

  // 在该一级索引块有没有对应bn的块号？
  if((addr = a2[dbnoff]) == 0){
    a2[dbnoff] = addr = balloc(ip->dev);
    log_write(bp2);
  }
  brelse(bp2);

  return addr;
}
```

## 修改itrunc函数
这个函数的作用是：    


### 修改前
```C
// 直接块处理方法（遍历直接块）
for(i = 0; i < NDIRECT; i++){
  if(ip->addrs[i]){
    bfree(ip->dev, ip->addrs[i]); // 如果存在映射，那就释放被映射的缓存块
    ip->addrs[i] = 0; // 然后取消映射
  }
}
```

```C
// 一级索引块处理方法（也差不多是遍历）
if(ip->addrs[NDIRECT]){ 

  // 进入块，进入的是一级索引块
  bp = bread(ip->dev, ip->addrs[NDIRECT]);
  a = (uint*)bp->data;

  // 遍历一级索引快
  for(j = 0; j < NINDIRECT; j++){
    if(a[j]) // 如果存在映射，就释放被映射的缓存块
      bfree(ip->dev, a[j]);
  }
  brelse(bp);
  // 释放一级索引块，并且取消映射
  bfree(ip->dev, ip->addrs[NDIRECT]);
  ip->addrs[NDIRECT] = 0;
  }
```

### 修改后
和刚刚一样，照葫芦画瓢。    
```C
// 二级索引块处理方法
if(ip->addrs[DINDIRECT]){

  // 进入集合块
  bp = bread(ip->dev, ip->addrs[DINDIRECT]);
  a = (uint*)bp->data;

  // 遍历集合块
  for(j = 0; j < NINDIRECT; j++){
    // 如果存在一级索引块，进入该块
    if(a[j]){
      bp2 = bread(ip->dev, a[j]);
      a2 = (uint*)bp2->data;

      // 清理一级索引块内的地址，和
      for(k = 0; k < NINDIRECT; k++){
        if(a2[k])
          bfree(ip->dev, a2[k]);
      }
      brelse(bp2);
      // 释放对应一级索引块
      bfree(ip->dev, a[j]);
    }
  }
  brelse(bp);
  // 释放并取消映射二级索引块
  bfree(ip->dev, ip->addrs[DINDIRECT]);
  ip->addrs[DINDIRECT] = 0;
}
```

## 小修小补
这个是我看whileskies大佬改的，不然的话我肯定不会改，压根不会想到这里，毕竟hints好像也没说呢。    
这里要改不要改都行，不影响测试结果，当然改了更好，鲁棒性更高嘛。    

在`file.c/filewrite()`
```C
// write a few blocks at a time to avoid exceeding
// the maximum log transaction size, including
// i-node, indirect block, allocation blocks,
// and 2 blocks of slop for non-aligned writes.
// this really belongs lower down, since writei()
// might be writing a device like the console.
int max = ((MAXOPBLOCKS-1-1-2) / 2) * BSIZE;
```
### 1. 核心概念解释
- **MAXOPBLOCKS** （10）    
  定义在`param.h`中，表示单个日志事务能容纳的最大块数  

- **max计算式**：  
  `((MAXOPBLOCKS-1-1-2)/2)*BSIZE`  
  分解说明：
  - 第一个-1：为inode块预留
  - 第二个-1：为间接块预留
  - -2：安全余量（对齐）
  - /2：保守估计系数 /* 这个是博主乱猜的 */
  - BSIZE(1024)：块大小

总而言之，`max`就是要避免日志溢出（单个事务太大超过日志区域）。   

我们得改成这样：    
```C
int max = ((MAXOPBLOCKS-1-2-2) / 2) * BSIZE;
```
就是2个间接块的意思。   

# symbolic links (moderate)     
这个小作业要做的是符号链接/软链接，类似于Windows上的“快捷方式”。     

## 基础概念：**硬链接与软链接的区别**    

| 区别           | 硬链接           | 软链接           | 
| -------------- | ---------------- | ---------------- |
| 文件标志       | 普通文件         | T_SYMLINK        |
| INODE          | **共享**目标文件 | **独立**新INODE  |
| 数据           | **共享**目标文件 | 目标文件路径     |
| 目标文件被删除 | **可**正常访问   | **不可**正常访问 |
| 跨设备         | **不可**跨设备   | **可**跨设备     |    
    
我们暂称软链接文件为“SF”。   
当我们创建SF时，它会被打上**T_SYMLINK**的标签，其他普通文件会被打上**T_FILE**的标签。   
然后创建后，我们想要打开该文件；系统就会发现它是**T_SYMLINK**标签的文件，并去读取该文件的`data`字段，`data`的内容为目标文件的路径，系统会解析该路径，并打开目标文件。   

## 实现
### 系统调用
这个读者们应该还记得吧，不记得就翻之前的LAB，这一步是最简单的了，添加系统调用而已，就是让用户态程序能调用内核函数的那步，声明定义一下就行了，先不写实现。    

这次系统调用长这样：    
```C
symlink(char *目标文件, char *新文件路径) // 不过别真用中文写参数名呀！
```

### 文件类型（标签）
首先先添加一个新的文件标签，就是刚刚说的那个，因为软链接文件和普通文件的处理方式不同，所以得有自己的标签。   
`kernel/stat.h`：    
```C
#define T_DIR     1   // Directory
#define T_FILE    2   // File
#define T_DEVICE  3   // Device
#define T_SYMLINK 4   // Symbolic link
```

然后有时候我们可能希望直接对这个软链接文件进行操作，比如以下这种场景：   
我们现在要打开SF，但是系统不知道我们其实只想看这个SF内所存储的是什么路径，所以它就直接打开了该文件，这不是用户预期行为。    
新的文件操作标志做的就是：   
不解析SF的路径，直接对SF进行操作。   
`kernel/stat.h`：    
```C
#define O_RDONLY      0x000
#define O_WRONLY      0x001
#define O_RDWR        0x002
#define O_CREATE      0x200
#define O_TRUNC       0x400
#define O_NOFOLLOW    0x800 
```

### 创建软链接文件
我们先来做最重要的函数，就是`symlink(target, linkpath)`。   
这个函数要做的事情只有把路径放进新文件里，就这么简单，你甚至不用检查这个路径是否存在文件。    

`kernel/sysfile.c`：    
```C
uint64
sys_symlink(void)
{
  char target[MAXPATH], linkpath[MAXPATH];
  uint len;
  struct inode *op, *ip;

  if(argstr(0, target, MAXPATH) < 0 || argstr(1, linkpath, MAXPATH) < 0)
    return -1;

  // 获取目标文件的INODE
  begin_op();
  if((op = namei(target)) != 0){
    ilock(op);
    if(op->type == T_DIR){
      iunlockput(op);
      end_op();
      return -1;
    }
    iunlockput(op);
  }

  // 创建软链接文件，并打上软链接对应的标签
  if((ip = create(linkpath, T_SYMLINK, 0, 0)) == 0){
    end_op();
    return -1;
  }

  // 对软链接文件的DATA写入路径
  len = strlen(target)+1;
  if(writei(ip, 0, (uint64)target, 0, len) != len){
    iunlockput(ip);
    end_op();
    return -1;
  }

  iupdate(ip);
  iunlockput(ip);
  end_op();

  return 0;
}
```

#### 递归打开
我们的软链接文件可能会指向另一个软链接文件，一直指向指向。    
所以我们要做一个递归，让系统能够找到目标文件。    
但是呢，也不能一直递归，因为用户可能会做65535个，那样的话系统不炸了吗，CPU一直在处理这个东西，太浪费性能了！    
```C
struct inode*
find_symlink(char *path, char *rpath, int depth)
{
  if(depth >= 10)
    return 0;

  struct inode *ip;
  if((ip = namei(path)) != 0){
    ilock(ip);

    if(ip->type != T_SYMLINK){
      iunlock(ip);
      return ip;
    }
    if(readi(ip, 0, (uint64)rpath, 0, ip->size) == 0){
      iunlockput(ip);
      return 0;
    }
    iunlockput(ip);

    return find_symlink(rpath, rpath, depth+1);
  }
  return 0;
}
```

### 打开文件
我们需要让`open()`可以处理`O_NOFOLLOW`的情况，所以就需要改一下。    
这里我们要清楚，我们的测试中，`O_NOFOLLOW`和`O_CREATE`几乎是不可能出现的，又或者说`O_CREATE`的优先级比`O_NOFOLLOW`更大。    
一样的，先看原版    
`sysfile.c/sys_open()`：    
```C
if(omode & O_CREATE){ // 创建文件分支
  ip = create(path, T_FILE, 0, 0);
  if(ip == 0){
    end_op();
    return -1;
  }
} else { // 不是要创建那就只有可能是打开了，OPEN函数嘛
  if((ip = namei(path)) == 0){ 
    end_op();
    return -1;
  }
/* OTHERS CODE */
}
```

改成这样：    
```C
if(omode & O_CREATE){ 
  ip = create(path, T_FILE, 0, 0);
  if(ip == 0){
    end_op();
    return -1;
  }
  goto general;
} else if(omode & O_NOFOLLOW) {
  if((ip = namei(path)) == 0){ // 直接返回INODE
    end_op();
    return -1;
  }
} else {
  char rpath[MAXPATH];
  if((ip = find_symlink(path, rpath, 0)) == 0){ // 如果找到非软链接文件就会返回INODE
    end_op();
    return -1;
  }
} 

/* 这里开始就不必在意了，重点是上面而已 */
ilock(ip);  
if(ip->type == T_DIR && omode != O_RDONLY){
  iunlockput(ip);
  end_op();
  return -1;
}

general:
  if(ip->type == T_DEVICE && (ip->major < 0 || ip->major >= NDEV)){
    iunlockput(ip);
    end_op();
    return -1;
  }

/* OTHERS CODE */
```

## 小知识
### POSIX标准的`O_NOFOLLOW`
POSIX的和XV6的有一些不同。
- XV6：不要跟随，直接打开软链接文件   
- POSIX：如果路径为软连接文件，直接返回错误

# 完结撒花 (　o=^•ェ•)o　┏━┓
相信做完这个LAB后，读者们对文件系统多少有点了解了，N级索引、软链接之类的。    
不过如果真想了解文件系统的话，还是得精度XV6的其他源码，只是做这个LAB是肯定不够的。

那就祝读者们好运啦，拜拜！o(〃＾▽＾〃)o   

最后编辑时间：2025/8/10
